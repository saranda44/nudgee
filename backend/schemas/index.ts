export { LIMITS } from "./limits.ts";
export { CATEGORIES, BRANCH_ORDER, AnalysisSchema, type Category } from "./categories.ts";
export { UNSUPPORTED_AI_SCHEMA_KEYWORDS, stripUnsupportedKeywords } from "./keywords-to-strip.ts";
export { validateAnalysis, formatValidationErrors, type ValidationIssue } from "./validators.ts";
export { type View } from "./common.ts";

import type { Static } from "@sinclair/typebox";
import { AnalysisSchema } from "./categories.ts";

/**
 * Tipo TS inferido de la definición (no escrito a mano). `AnalysisSchema(view)`
 * es una función normal sobre `View`, así que TypeScript no distingue el tipo
 * de retorno por el valor del argumento en cada llamada: esta es la unión de
 * las 2 vistas (stored | input), no un tipo exclusivo por vista. La
 * precisión real por vista la da Ajv en runtime (validateAnalysis).
 */
export type AnalysisResult = Static<ReturnType<typeof AnalysisSchema>>;
