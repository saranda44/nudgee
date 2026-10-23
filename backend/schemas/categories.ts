import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import {
  CheckListField,
  EntryTextField,
  ListCategoryDetails,
  StepsField,
  SummaryField,
  TitleField,
  YearField,
  type View,
} from "./common.ts";

/** Las 10 categorías del modelo. */
export const CATEGORIES = [
  "RECIPE",
  "ROUTINE",
  "TUTORIAL",
  "MOVIE_SERIES",
  "PLACE",
  "BOOK",
  "MUSIC",
  "PODCAST",
  "EVENT",
  "OTHER",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Orden exacto de las ramas dentro de `AnalysisSchema` (debe coincidir con el
 * arreglo de Type.Union más abajo). Lo usa el formateador de errores para
 * ubicar la rama de la categoría que mandó el cliente dentro del `anyOf`.
 */
export const BRANCH_ORDER: readonly Category[] = [
  "RECIPE",
  "ROUTINE",
  "TUTORIAL",
  "MOVIE_SERIES",
  "PLACE",
  "BOOK",
  "MUSIC",
  "PODCAST",
  "EVENT",
  "OTHER",
];

/** Encabezado común a toda rama: category + title + summary. */
function withHeader(view: View, category: Category, details: Record<string, TSchema>) {
  return Type.Object(
    {
      category: Type.Literal(category),
      title: TitleField(),
      summary: SummaryField(view),
      ...details,
    },
    { additionalProperties: false },
  );
}

function recipeBranch(view: View) {
  return withHeader(view, "RECIPE", {
    details: Type.Object(
      {
        ingredients: CheckListField(view, {
          required: true,
          itemDescription: "One ingredient with its quantity inside the text, e.g. '200 g of flour'.",
          listDescription: "Ingredients needed, in the order used.",
        }),
        steps: StepsField("Preparation steps, numbered by order; rewrite concisely, do not copy long sentences."),
        prepTime: Type.Optional(Type.Integer({ minimum: 0, description: "Preparation time in minutes, if stated." })),
      },
      { additionalProperties: false },
    ),
  });
}

function routineBranch(view: View) {
  return withHeader(view, "ROUTINE", {
    details: Type.Object(
      {
        exercises: CheckListField(view, {
          required: true,
          itemDescription: "One exercise, e.g. '3x12 sentadillas'.",
          listDescription: "Exercises in the order performed.",
        }),
        durationMin: Type.Optional(Type.Integer({ minimum: 0, description: "Total routine duration in minutes, if stated." })),
      },
      { additionalProperties: false },
    ),
  });
}

/**
 * TUTORIAL: materials y steps son opcionales, pero al menos uno debe
 * tener contenido. En stored/input esa regla sí va en el schema (allOf + anyOf);
 * en ai no.
 */
function tutorialBranch(view: View) {
  const base = withHeader(view, "TUTORIAL", {
    details: Type.Object(
      {
        materials: CheckListField(view, {
          required: false,
          itemDescription: "One material or tool needed.",
          listDescription: "Materials or tools used, if any.",
        }),
        steps: StepsField("Tutorial steps, numbered by order; rewrite concisely."),
      },
      { additionalProperties: false },
    ),
  });

  if (view === "ai") return base;

  const atLeastOneWithContent = Type.Union([
    Type.Object({ details: Type.Object({ materials: Type.Array(Type.Unknown(), { minItems: 1 }) }, { required: ["materials"] }) }),
    Type.Object({ details: Type.Object({ steps: Type.Array(Type.Unknown(), { minItems: 1 }) }, { required: ["steps"] }) }),
  ]);

  return Type.Intersect([base, atLeastOneWithContent]);
}

function eventBranch(view: View) {
  return withHeader(view, "EVENT", {
    details: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 200, description: "Event name." }),
        eventDate: Type.Optional(
          Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Event date YYYY-MM-DD, only if the year is known or confirmed." }),
        ),
        eventTime: Type.Optional(Type.String({ pattern: "^\\d{2}:\\d{2}$", description: "Local event time HH:mm, if stated." })),
        cityOrAddress: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "City or address, if stated." })),
        // Solo vista ai: día y mes sin año; el worker la resuelve a eventDate y la descarta.
        ...(view === "ai"
          ? { eventMonthDay: Type.Optional(Type.String({ pattern: "^\\d{2}-\\d{2}$", description: "MM-DD when day and month are explicit but the year is unknown." })) }
          : {}),
      },
      { additionalProperties: false },
    ),
  });
}

/** OTHER no tiene `details` (SCH-16). */
function otherBranch(view: View) {
  return withHeader(view, "OTHER", {});
}

function movieSeriesBranch(view: View) {
  return withHeader(view, "MOVIE_SERIES", {
    details: ListCategoryDetails(
      view,
      {
        title: EntryTextField("Movie or series title.", true),
        mediaType: Type.Union([Type.Literal("MOVIE"), Type.Literal("SERIES")], { description: "If unclear, use MOVIE." }),
        year: YearField(),
      },
      "Movies or series recommended, in order of appearance.",
    ),
  });
}

function placeBranch(view: View) {
  return withHeader(view, "PLACE", {
    details: ListCategoryDetails(
      view,
      {
        name: EntryTextField("Place name.", true),
        cityOrAddress: EntryTextField("City or address, if stated.", false),
      },
      "Places recommended, in order of appearance.",
    ),
  });
}

function bookBranch(view: View) {
  return withHeader(view, "BOOK", {
    details: ListCategoryDetails(
      view,
      {
        title: EntryTextField("Book title.", true),
        author: EntryTextField("Author, if stated.", false),
      },
      "Books recommended, in order of appearance.",
    ),
  });
}

function musicBranch(view: View) {
  return withHeader(view, "MUSIC", {
    details: ListCategoryDetails(
      view,
      {
        name: EntryTextField("Song, album or artist name.", true),
        musicType: Type.Union([Type.Literal("SONG"), Type.Literal("ALBUM"), Type.Literal("ARTIST")], {
          description: "If unclear, use SONG.",
        }),
        artist: EntryTextField("Artist, if different from name and stated.", false),
        genre: EntryTextField("Musical genre, if stated.", false),
      },
      "Songs, albums or artists recommended, in order of appearance.",
    ),
  });
}

function podcastBranch(view: View) {
  return withHeader(view, "PODCAST", {
    details: ListCategoryDetails(
      view,
      {
        showName: EntryTextField("Podcast show name.", true),
        episode: EntryTextField("Episode title or number, if stated.", false),
      },
      "Podcasts recommended, in order of appearance.",
    ),
  });
}

/** Unión discriminada por `category`, 10 ramas, una por categoría. */
export function AnalysisSchema(view: View) {
  return Type.Union([
    recipeBranch(view),
    routineBranch(view),
    tutorialBranch(view),
    movieSeriesBranch(view),
    placeBranch(view),
    bookBranch(view),
    musicBranch(view),
    podcastBranch(view),
    eventBranch(view),
    otherBranch(view),
  ]);
}
