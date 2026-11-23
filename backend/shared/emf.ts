/**
 * Métricas EMF (Embedded Metric Format, NFR-10 / ARQ-18): un `console.log` con la forma
 * que CloudWatch Logs convierte en métrica del namespace `Nudgee`. Sin llamadas a la API
 * de CloudWatch, así que no agrega latencia ni puede fallar la invocación.
 *
 * Las dimensiones deben ser de baja cardinalidad (status, tipo); nunca userId ni videoId:
 * cada combinación distinta es una métrica nueva con costo.
 */

export interface EmfMetric {
  name: string;
  value: number;
  unit: "Milliseconds" | "Count";
}

export function emitMetrics(metrics: EmfMetric[], dimensions: Record<string, string> = {}): void {
  const payload: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: "Nudgee",
          // `[[]]` es válido: la métrica queda sin dimensiones.
          Dimensions: [Object.keys(dimensions)],
          Metrics: metrics.map((m) => ({ Name: m.name, Unit: m.unit })),
        },
      ],
    },
    ...dimensions,
  };
  for (const m of metrics) payload[m.name] = m.value;
  console.log(JSON.stringify(payload));
}
