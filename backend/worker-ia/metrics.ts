/**
 * Métricas EMF sin llamadas extra en la ruta crítica:
 * AnalysisDurationMs, GeminiCallMs, GeminiError. Un `console.log` con la
 * forma que CloudWatch Logs interpreta como métrica (Embedded Metric Format).
 */

interface EmfMetric {
  name: string;
  value: number;
  unit: "Milliseconds" | "Count";
}

function emit(metrics: EmfMetric[], dimensions: Record<string, string> = {}): void {
  const dimensionKeys = Object.keys(dimensions);
  const payload: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: "Nudgee",
          Dimensions: [dimensionKeys],
          Metrics: metrics.map((m) => ({ Name: m.name, Unit: m.unit })),
        },
      ],
    },
    ...dimensions,
  };
  for (const m of metrics) payload[m.name] = m.value;
  console.log(JSON.stringify(payload));
}

/** `readyAt - savedAt`, dimensión `analysisSource` (GEMINI o CACHE). */
export function emitAnalysisDuration(durationMs: number, analysisSource: "GEMINI" | "CACHE"): void {
  emit([{ name: "AnalysisDurationMs", value: durationMs, unit: "Milliseconds" }], { analysisSource });
}

export function emitGeminiCallDuration(durationMs: number): void {
  emit([{ name: "GeminiCallMs", value: durationMs, unit: "Milliseconds" }]);
}

/** Por tipo: 429, 5xx, TIMEOUT o INVALID_OUTPUT. */
export function emitGeminiError(type: "429" | "5xx" | "TIMEOUT" | "INVALID_OUTPUT"): void {
  emit([{ name: "GeminiError", value: 1, unit: "Count" }], { type });
}
