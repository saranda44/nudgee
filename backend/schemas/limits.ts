/**
 * Límites de los campos de análisis, un solo lugar.
 */
export const LIMITS = {
  title: { minLength: 1, maxLength: 120 },
  summary: { maxLength: 500 },
  /** Elementos marcables (ingredients, exercises, materials): texto y conteo. */
  checkItem: { minLength: 1, maxLength: 200, maxItems: 50 },
  /** `steps` de RECIPE/TUTORIAL. */
  steps: { minLength: 1, maxLength: 500, maxItems: 30 },
  /** `entries` de las 5 categorías de lista. */
  entries: { minItems: 1, maxItems: 20 },
  /** Textos dentro de cada entrada (title, name, author, artist, genre, showName, episode, cityOrAddress). */
  entryText: { minLength: 1, maxLength: 200 },
  year: { minimum: 1888, maximum: 2100 },
} as const;
