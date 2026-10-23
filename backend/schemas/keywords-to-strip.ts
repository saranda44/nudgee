/**
 * Ajuste del schema de la vista `ai` para el modo de salida estructurada de
 * Gemini (OpenAPI 3.0 subset, no JSON Schema completo). Provisional hasta
 * resolver V-10 (ai-schemas.md §10): hoy es una lista razonable de keywords
 * que ese subconjunto no soporta; se corrige con pruebas reales contra AI Studio.
 */
export const UNSUPPORTED_AI_SCHEMA_KEYWORDS = [
  "$ref",
  "$defs",
  "definitions",
  "additionalProperties",
  "patternProperties",
  "allOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
] as const;

/**
 * Limpia recursivamente un JSON Schema de TypeBox para enviarlo como
 * `responseSchema` a Gemini: convierte `const` a `enum` de un solo valor
 * (Gemini no soporta `const`, pero sí `enum`) y elimina las keywords de
 * UNSUPPORTED_AI_SCHEMA_KEYWORDS en cualquier nivel de anidación.
 */
export function stripUnsupportedKeywords(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(stripUnsupportedKeywords);
  }
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if ((UNSUPPORTED_AI_SCHEMA_KEYWORDS as readonly string[]).includes(key)) {
      continue;
    }
    if (key === "const") {
      result.enum = [value];
      continue;
    }
    result[key] = stripUnsupportedKeywords(value);
  }
  return result;
}
