/**
 * Métricas EMF del worker sin llamadas extra en la ruta crítica:
 * AnalysisDurationMs, GeminiCallMs, GeminiError (formato en shared/emf.ts).
 */

import { emitMetrics } from "../shared/emf.ts";

/** `readyAt - savedAt`, dimensión `analysisSource` (GEMINI o CACHE). */
export function emitAnalysisDuration(durationMs: number, analysisSource: "GEMINI" | "CACHE"): void {
  emitMetrics([{ name: "AnalysisDurationMs", value: durationMs, unit: "Milliseconds" }], { analysisSource });
}

export function emitGeminiCallDuration(durationMs: number): void {
  emitMetrics([{ name: "GeminiCallMs", value: durationMs, unit: "Milliseconds" }]);
}

/** Por tipo: 429, 5xx, TIMEOUT, CLIENT_ERROR o INVALID_OUTPUT. */
export function emitGeminiError(type: "429" | "5xx" | "TIMEOUT" | "CLIENT_ERROR" | "INVALID_OUTPUT"): void {
  emitMetrics([{ name: "GeminiError", value: 1, unit: "Count" }], { type });
}
