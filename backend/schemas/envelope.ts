import { Type } from "@sinclair/typebox";
import { AnalysisSchema } from "./categories.ts";

/**
 * Sobre de salida de Gemini.
 * outcome=OK trae analysis+confidence; outcome=CANNOT_ANALYZE trae reason.
 * `confidence` queda fuera de `analysis`.
 */
export const AiEnvelopeSchema = Type.Union([
  Type.Object(
    {
      // Orden de llaves: outcome -> analysis (category -> title -> summary -> details) -> confidence.
      outcome: Type.Literal("OK"),
      analysis: AnalysisSchema("ai"),
      confidence: Type.Number({ minimum: 0, maximum: 1, description: "Self-reported confidence in the category and required fields; see the rubric in the prompt." }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      outcome: Type.Literal("CANNOT_ANALYZE"),
      // solo para logs y métricas, no cambia el resultado (siempre NEEDS_INPUT + VIDEO_UNAVAILABLE).
      reason: Type.Union([Type.Literal("NO_ACCESS"), Type.Literal("PROCESSING_FAILED")]),
    },
    { additionalProperties: false },
  ),
]);
