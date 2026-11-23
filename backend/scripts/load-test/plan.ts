/**
 * Lógica pura de las pruebas de carga (docs/observabilidad.md §5), separada para probarla sin AWS.
 */

/** Cuota de Ingesta (backend/ingesta/dynamo.ts): 30 guardados por hora y 100 por día por usuario. */
export const HOUR_LIMIT = 30;

export interface PlannedRequest {
  userIndex: number;
  videoId: string;
}

/**
 * Reparte el pool entre usuarios sin repetir usuario + videoId (repetirlo da 409 y la FIFO lo
 * descarta). Cada usuario arranca en un video distinto para que la ráfaga no le pegue a uno solo.
 * Intercala usuarios (ronda por ronda) para que la carga se reparta en el tiempo.
 */
export function buildPlan(userCount: number, videos: string[], perUser: number, maxRequests: number): PlannedRequest[] {
  if (userCount <= 0 || videos.length === 0 || maxRequests <= 0) return [];
  const k = Math.min(perUser, videos.length, HOUR_LIMIT);
  const plan: PlannedRequest[] = [];
  for (let round = 0; round < k; round++) {
    for (let u = 0; u < userCount; u++) {
      if (plan.length >= maxRequests) return plan;
      plan.push({ userIndex: u, videoId: videos[(u + round) % videos.length] });
    }
  }
  return plan;
}

/** Percentil por rango más cercano; `values` no necesita venir ordenado. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/**
 * Corta la corrida si los errores del servidor (5xx o fallos de red) pasan del umbral, una vez
 * que hay una muestra mínima. 409 y 429 son respuestas esperadas, no errores.
 */
export function shouldAbort(done: number, serverErrors: number, minSample = 50, maxRatio = 0.05): boolean {
  return done >= minSample && serverErrors / done > maxRatio;
}

/** Lee un pool de videoIds (uno por línea, `#` comenta) y descarta repetidos e inválidos. */
export function parseVideoPool(text: string): { videos: string[]; invalid: string[] } {
  const videos: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    if (!/^[A-Za-z0-9_-]{11}$/.test(line)) invalid.push(line);
    else if (!videos.includes(line)) videos.push(line);
  }
  return { videos, invalid };
}
