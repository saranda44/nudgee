import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { LIMITS } from "./limits.ts";

/** Las 2 vistas: stored (id obligatorio) e input (id opcional, API-15). */
export type View = "stored" | "input";

/** `id` de elementos marcables y entradas: obligatorio en stored, opcional en input. */
export function idProperty(view: View): Record<string, TSchema> {
  const id = Type.String({ description: "Stable id assigned by the server (e.g. i3 or e2); never invent one." });
  return { id: view === "stored" ? id : Type.Optional(id) };
}

export function TitleField() {
  return Type.String({ ...LIMITS.title, description: "Short, descriptive title. Not clickbait." });
}

/** Siempre opcional en stored e input (E-09: el formulario puede omitirlo). */
export function SummaryField() {
  return Type.Optional(Type.String({ maxLength: LIMITS.summary.maxLength, description: "One or two sentence summary." }));
}

/** Un elemento marcable: `{ id, text }` (ingredients, exercises, materials). */
export function CheckItemSchema(view: View, textDescription: string) {
  return Type.Object(
    {
      ...idProperty(view),
      text: Type.String({ minLength: LIMITS.checkItem.minLength, maxLength: LIMITS.checkItem.maxLength, description: textDescription }),
    },
    { additionalProperties: false },
  );
}

/**
 * Lista de elementos marcables. `required = true` -> la llave es obligatoria y pide ≥1
 * (ingredients, exercises); `required = false` -> la llave es opcional y acepta 0.
 */
export function CheckListField(view: View, opts: { required: boolean; itemDescription: string; listDescription: string }) {
  const list = Type.Array(CheckItemSchema(view, opts.itemDescription), {
    minItems: opts.required ? 1 : 0,
    maxItems: LIMITS.checkItem.maxItems,
    description: opts.listDescription,
  });
  return opts.required ? list : Type.Optional(list);
}

/** Lista de pasos (texto plano, no marcable): RECIPE.steps, TUTORIAL.steps. */
export function StepsField(description: string) {
  return Type.Optional(
    Type.Array(Type.String({ minLength: LIMITS.steps.minLength, maxLength: LIMITS.steps.maxLength }), {
      maxItems: LIMITS.steps.maxItems,
      description,
    }),
  );
}

export function EntryTextField(description: string, required: boolean) {
  const text = Type.String({ minLength: LIMITS.entryText.minLength, maxLength: LIMITS.entryText.maxLength, description });
  return required ? text : Type.Optional(text);
}

export function YearField() {
  return Type.Optional(Type.Integer({ minimum: LIMITS.year.minimum, maximum: LIMITS.year.maximum, description: "Release year, if clearly stated." }));
}

/** `details.entries`: 1-20, forma por categoría en `entryProperties`. */
export function EntryListField(view: View, entryProperties: Record<string, TSchema>, description: string) {
  const entry = Type.Object({ ...idProperty(view), ...entryProperties }, { additionalProperties: false });
  return Type.Array(entry, { minItems: LIMITS.entries.minItems, maxItems: LIMITS.entries.maxItems, description });
}

/** `details` de las 5 categorías de lista (MOVIE_SERIES, PLACE, BOOK, MUSIC, PODCAST): solo `entries`. */
export function ListCategoryDetails(view: View, entryProperties: Record<string, TSchema>, description: string) {
  return Type.Object({ entries: EntryListField(view, entryProperties, description) }, { additionalProperties: false });
}
