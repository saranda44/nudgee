/**
 * Keywords de JSON Schema que no son soportadas por Gemini (Interactions API, @google/genai) 
 * y que deben ser eliminadas antes de enviar el schema a la API.
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
  // Confirmados "ignorados, no exigidos" por @google/genai (no dan error).
  "minLength",
  "maxLength",
  "minProperties",
  "maxProperties",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  // Confirmados como causa real de 400 "too many states for serving" en un
  // schema grande; normalize.ts ya los valida/recorta en código de todos modos.
  "pattern",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
] as const;

/**
 * Limpia recursivamente un JSON Schema de TypeBox para enviarlo como
 * `response_format.schema` a Gemini: convierte `const` a `enum` de un solo
 * valor (Gemini no soporta `const`, pero sí `enum`), elimina las keywords de
 * UNSUPPORTED_AI_SCHEMA_KEYWORDS en cualquier nivel de anidación, y agrega
 * `propertyOrdering` (extensión de Gemini) en cada objeto para que respete el
 * orden de llaves — confirmado en vivo contra AI Studio.
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

  if (result.properties && typeof result.properties === "object") {
    result.propertyOrdering = Object.keys(result.properties as Record<string, unknown>);
  }

  return result;
}
