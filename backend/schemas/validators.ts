import { Ajv } from "ajv";
import type { ErrorObject } from "ajv";
import { AnalysisSchema, BRANCH_ORDER, CATEGORIES, type Category } from "./categories.ts";
import type { View } from "./common.ts";

/** additionalProperties:false explícito en cada objeto; allErrors para juntar todos los problemas de una. */
const ajv = new Ajv({ allErrors: true, strict: true });

const analysisValidators: Record<View, ReturnType<typeof ajv.compile>> = {
  stored: ajv.compile(AnalysisSchema("stored")),
  input: ajv.compile(AnalysisSchema("input")),
};

export function validateAnalysis(view: View, data: unknown) {
  const validate = analysisValidators[view];
  const valid = validate(data);
  return { valid, errors: valid ? null : formatValidationErrors(validate.errors, data) };
}

export interface ValidationIssue {
  pointer: string;
  code: string;
  message: string;
}

const KEYWORD_TO_CODE: Record<string, string> = {
  required: "REQUIRED",
  maxLength: "MAX_LENGTH",
  minLength: "MIN_LENGTH",
  maxItems: "MAX_ITEMS",
  minItems: "MIN_ITEMS",
  enum: "ENUM",
  const: "ENUM",
  type: "INVALID_TYPE",
  additionalProperties: "UNKNOWN_FIELD",
  pattern: "INVALID_FORMAT",
  minimum: "MIN_VALUE",
  maximum: "MAX_VALUE",
};

function codeFor(error: ErrorObject): string {
  return KEYWORD_TO_CODE[error.keyword] ?? error.keyword.toUpperCase();
}

function pointerFor(error: ErrorObject): string {
  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty?: string }).missingProperty;
    return `${error.instancePath}/${missing}`;
  }
  return error.instancePath || "/";
}

/**
 * `AnalysisSchema` es una unión de 10 ramas: sin filtrar, Ajv reporta
 * el fallo de las 10 a la vez. Si el dato trae una `category` reconocible, nos
 * quedamos solo con los errores de esa rama (un pointer por campo real).
 */
function filterToMatchingBranch(errors: ErrorObject[], data: unknown): ErrorObject[] {
  const category = (data as { category?: unknown } | null)?.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category as Category)) {
    return errors;
  }
  const branchIndex = BRANCH_ORDER.indexOf(category as Category);
  if (branchIndex === -1) return errors;

  const prefix = `#/anyOf/${branchIndex}/`;
  const branchErrors = errors.filter((e) => e.schemaPath.startsWith(prefix));
  return branchErrors.length > 0 ? branchErrors : errors;
}

export function formatValidationErrors(errors: ErrorObject[] | null | undefined, data?: unknown): ValidationIssue[] {
  if (!errors || errors.length === 0) return [];
  const relevant = filterToMatchingBranch(errors, data);
  return relevant
    .filter((e) => !(e.keyword === "anyOf" && e.schemaPath === "#/anyOf")) // el anyOf raíz de las 10 ramas, no uno real (ej. la regla de TUTORIAL sí es real)
    .filter((e) => !(e.keyword === "const" && e.instancePath.endsWith("/category"))) // el discriminador de la rama, ya resuelto
    .map((e) => ({ pointer: pointerFor(e), code: codeFor(e), message: e.message ?? "invalid value" }));
}
