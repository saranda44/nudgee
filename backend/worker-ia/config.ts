/** Todos los valores configurables del worker. */
export interface WorkerConfig {
  geminiModel: string;
  enableGrounding: boolean;
  analysisVersion: number;
  cacheConfidenceThreshold: number;
  cacheTtlOkSeconds: number;
  cacheTtlUnavailableSeconds: number;
  geminiTimeoutMs: number;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value === "true";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    geminiModel: env.GEMINI_MODEL ?? "",
    enableGrounding: parseBool(env.ENABLE_GROUNDING, true),
    analysisVersion: parseNumber(env.ANALYSIS_VERSION, 1),
    cacheConfidenceThreshold: parseNumber(env.CACHE_CONFIDENCE_THRESHOLD, 0.7),
    cacheTtlOkSeconds: parseNumber(env.CACHE_TTL_OK_SECONDS, 90 * 24 * 60 * 60),
    cacheTtlUnavailableSeconds: parseNumber(env.CACHE_TTL_UNAVAILABLE_SECONDS, 60 * 60),
    geminiTimeoutMs: parseNumber(env.GEMINI_TIMEOUT_MS, 45_000),
  };
}
