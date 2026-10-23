export { LIMITS } from "./limits.ts";
export { CATEGORIES, BRANCH_ORDER, AnalysisSchema, type Category } from "./categories.ts";
export { AiEnvelopeSchema } from "./envelope.ts";
export { UNSUPPORTED_AI_SCHEMA_KEYWORDS, stripUnsupportedKeywords } from "./keywords-to-strip.ts";
export { validateAnalysis, validateAiEnvelope, formatValidationErrors, type ValidationIssue } from "./validators.ts";
export { type View } from "./common.ts";

import type { Static } from "@sinclair/typebox";
import { AnalysisSchema } from "./categories.ts";
import { AiEnvelopeSchema } from "./envelope.ts";

/**
 * Tipo TS inferido de la definición (no escrito a mano). `AnalysisSchema(view)`
 * es una función normal sobre `View`, así que TypeScript no distingue el tipo
 * de retorno por el valor del argumento en cada llamada: esta es la unión de
 * las 3 vistas (stored | input | ai), no un tipo exclusivo por vista. La
 * precisión real por vista la da Ajv en runtime (validateAnalysis).
 */
export type AnalysisResult = Static<ReturnType<typeof AnalysisSchema>>;

export type AiEnvelope = Static<typeof AiEnvelopeSchema>;
