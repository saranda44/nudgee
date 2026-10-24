import { AnalysisSchema } from "../schemas/index.ts";
import { stripUnsupportedKeywords } from "../schemas/keywords-to-strip.ts";
import type { WorkerConfig } from "./config.ts";
import { type AnalysisForItem, markItemNeedsInput, markItemPending, readAnalysisCache, writeAnalysisCache } from "./dynamo.ts";
import { analyzeWithGemini } from "./gemini.ts";
import { createIdGenerator, normalizeAiOutput } from "./normalize.ts";
import { buildPrompt } from "./prompt.ts";

export interface AnalysisMessage {
  userId: string;
  videoId: string;
  correlationId: string;
  savedAt: string;
}

export type ProcessAnalysisOutcome =
  | { kind: "cache_hit_ok" }
  | { kind: "cache_hit_unavailable" }
  | { kind: "analyzed_ok" }
  | { kind: "low_confidence" }
  | { kind: "cannot_analyze" }
  | { kind: "invalid_output" }
  | { kind: "skipped_not_processing" };

export interface ProcessAnalysisInput {
  message: AnalysisMessage;
  now: Date;
  config: WorkerConfig;
}

/**
 * Orquesta un mensaje (lote de 1): caché -> Gemini -> normalización -> guardado
 * (pasos 1-5). No atrapa GeminiCallError: el caller
 * (index.ts) decide el backoff según el contador de recepciones de SQS (paso 6).
 */
export async function processAnalysis(input: ProcessAnalysisInput): Promise<ProcessAnalysisOutcome> {
  const { message, now, config } = input;

  const cached = await readAnalysisCache(message.videoId, config.analysisVersion, now);

  if (cached?.result === "OK") {
    const { skipped } = await markItemPending({
      userId: message.userId,
      videoId: message.videoId,
      savedAt: message.savedAt,
      analysis: cached.analysis as AnalysisForItem,
      confidence: cached.confidence ?? 0,
      analysisSource: "CACHE",
      now,
    });
    return skipped ? { kind: "skipped_not_processing" } : { kind: "cache_hit_ok" };
  }

  if (cached?.result === "UNAVAILABLE") {
    const { skipped } = await markItemNeedsInput({ userId: message.userId, videoId: message.videoId, analysisError: "VIDEO_UNAVAILABLE", now });
    return skipped ? { kind: "skipped_not_processing" } : { kind: "cache_hit_unavailable" };
  }

  const videoUrl = `https://www.youtube.com/watch?v=${message.videoId}`;
  const prompt = buildPrompt({ groundingEnabled: config.enableGrounding });
  const schema = stripUnsupportedKeywords(AnalysisSchema("ai"));

  // GeminiCallError (429/5xx/timeout) se propaga a propósito: el handler decide el backoff.
  const rawText = await analyzeWithGemini(videoUrl, prompt, schema, {
    groundingEnabled: config.enableGrounding,
    timeoutMs: config.geminiTimeoutMs,
  });

  const normalized = normalizeAiOutput(rawText, now, createIdGenerator());

  if (normalized.kind === "CANNOT_ANALYZE") {
    await writeAnalysisCache({
      videoId: message.videoId,
      analysisVersion: config.analysisVersion,
      result: "UNAVAILABLE",
      model: config.geminiModel,
      correlationId: message.correlationId,
      now,
      ttlSeconds: config.cacheTtlUnavailableSeconds,
    });
    const { skipped } = await markItemNeedsInput({ userId: message.userId, videoId: message.videoId, analysisError: "VIDEO_UNAVAILABLE", now });
    return skipped ? { kind: "skipped_not_processing" } : { kind: "cannot_analyze" };
  }

  if (normalized.kind === "INVALID_OUTPUT") {
    const { skipped } = await markItemNeedsInput({ userId: message.userId, videoId: message.videoId, analysisError: "INVALID_OUTPUT", now });
    return skipped ? { kind: "skipped_not_processing" } : { kind: "invalid_output" };
  }

  const isCacheable = normalized.confidence >= config.cacheConfidenceThreshold;
  if (isCacheable) {
    await writeAnalysisCache({
      videoId: message.videoId,
      analysisVersion: config.analysisVersion,
      result: "OK",
      analysis: normalized.analysis,
      confidence: normalized.confidence,
      model: config.geminiModel,
      correlationId: message.correlationId,
      now,
      ttlSeconds: config.cacheTtlOkSeconds,
    });
  }

  const { skipped } = await markItemPending({
    userId: message.userId,
    videoId: message.videoId,
    savedAt: message.savedAt,
    analysis: normalized.analysis as AnalysisForItem,
    confidence: normalized.confidence,
    analysisSource: "GEMINI",
    now,
  });

  if (skipped) return { kind: "skipped_not_processing" };
  return isCacheable ? { kind: "analyzed_ok" } : { kind: "low_confidence" };
}
