import { Type } from "@sinclair/typebox";
import { CATEGORIES } from "./categories.ts";
import { LIMITS } from "./limits.ts";

/**
 * Schema "plano" para `response_format` de Gemini 
 *
 * Un `anyOf` de 10 ramas (una por categoría, cada una con su propio `details`)
 * resultó "demasiado complejo" para el resolvedor de restricciones de Gemini:
 * 400 "too many states for serving", confirmado en vivo contra la API real
 * (una sola rama sí funciona; las 10 juntas no). Aquí `details` es un solo
 * objeto con todos los campos posibles opcionales — el prompt (texto) sigue
 * diciendo qué llenar según la categoría; la obligatoriedad real la impone
 * Ajv contra la vista `stored` en `normalize.ts`, que no cambia.
 */
export function buildGeminiFlatSchema() {
  const checkItem = Type.Object(
    { text: Type.String({ minLength: 1, maxLength: LIMITS.checkItem.maxLength }) },
    { additionalProperties: false },
  );

  const entry = Type.Object(
    {
      title: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength, description: "Movie/series or book title." })),
      name: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength, description: "Place name, or song/album/artist name." })),
      mediaType: Type.Optional(Type.Union([Type.Literal("MOVIE"), Type.Literal("SERIES")])),
      year: Type.Optional(Type.Integer({ minimum: LIMITS.year.minimum, maximum: LIMITS.year.maximum })),
      cityOrAddress: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength })),
      author: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength })),
      musicType: Type.Optional(Type.Union([Type.Literal("SONG"), Type.Literal("ALBUM"), Type.Literal("ARTIST")])),
      artist: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength })),
      genre: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength })),
      showName: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength })),
      episode: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength })),
    },
    { additionalProperties: false },
  );

  const details = Type.Object(
    {
      ingredients: Type.Optional(Type.Array(checkItem, { maxItems: LIMITS.checkItem.maxItems, description: "RECIPE: ingredients." })),
      steps: Type.Optional(Type.Array(Type.String({ maxLength: LIMITS.steps.maxLength }), { maxItems: LIMITS.steps.maxItems, description: "RECIPE/TUTORIAL: steps." })),
      prepTime: Type.Optional(Type.Integer({ minimum: 0, description: "RECIPE: minutes." })),
      exercises: Type.Optional(Type.Array(checkItem, { maxItems: LIMITS.checkItem.maxItems, description: "ROUTINE: exercises." })),
      durationMin: Type.Optional(Type.Integer({ minimum: 0, description: "ROUTINE: minutes." })),
      materials: Type.Optional(Type.Array(checkItem, { maxItems: LIMITS.checkItem.maxItems, description: "TUTORIAL: materials." })),
      name: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength, description: "EVENT: event name." })),
      eventDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "EVENT: YYYY-MM-DD, only if year is known." })),
      eventTime: Type.Optional(Type.String({ pattern: "^\\d{2}:\\d{2}$", description: "EVENT: HH:mm." })),
      cityOrAddress: Type.Optional(Type.String({ maxLength: LIMITS.entryText.maxLength, description: "EVENT: city or address." })),
      eventMonthDay: Type.Optional(Type.String({ pattern: "^\\d{2}-\\d{2}$", description: "EVENT: MM-DD when year is unknown." })),
      entries: Type.Optional(
        Type.Array(entry, { maxItems: LIMITS.entries.maxItems, description: "MOVIE_SERIES/PLACE/BOOK/MUSIC/PODCAST: 1-20 entries, in order of appearance." }),
      ),
    },
    { additionalProperties: false },
  );

  const analysis = Type.Object(
    {
      category: Type.Union(CATEGORIES.map((category) => Type.Literal(category))),
      title: Type.String({ minLength: 1, maxLength: LIMITS.title.maxLength }),
      summary: Type.String({ maxLength: LIMITS.summary.maxLength }),
      details: Type.Optional(details),
    },
    { additionalProperties: false },
  );

  return Type.Union([
    Type.Object(
      { outcome: Type.Literal("OK"), analysis, confidence: Type.Number({ minimum: 0, maximum: 1 }) },
      { additionalProperties: false },
    ),
    Type.Object(
      { outcome: Type.Literal("CANNOT_ANALYZE"), reason: Type.Union([Type.Literal("NO_ACCESS"), Type.Literal("PROCESSING_FAILED")]) },
      { additionalProperties: false },
    ),
  ]);
}
