import { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda';
import { loadConfig } from './config.ts';
import { markItemNeedsInput } from './dynamo.ts';
import { GeminiCallError } from './gemini.ts';
import { logError, logInfo } from './logging.ts';
import { emitAnalysisDuration, emitGeminiError } from './metrics.ts';
import { processAnalysis, type AnalysisMessage } from './process-analysis.ts';
import { isLastAttempt, scheduleRetry } from './sqs-backoff.ts';

// Una vez por contenedor, no en cada invocación.
const config = loadConfig();

function geminiErrorMetricType(kind: GeminiCallError["kind"]): "429" | "5xx" | "TIMEOUT" | undefined {
  if (kind === "RATE_LIMIT") return "429";
  if (kind === "SERVER_ERROR") return "5xx";
  if (kind === "TIMEOUT") return "TIMEOUT";
  return undefined; // UNKNOWN: no es un error controlado de Gemini, se deja propagar
}

async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as AnalysisMessage;
  const receiveCount = Number(record.attributes.ApproximateReceiveCount ?? "1");
  const now = new Date();

  logInfo("Procesando análisis", message.correlationId, { videoId: message.videoId, attempt: receiveCount });

  try {
    const outcome = await processAnalysis({ message, now, config });
    logInfo("Análisis resuelto", message.correlationId, { videoId: message.videoId, outcome: outcome.kind });

    if (outcome.kind !== "skipped_not_processing") {
      const analysisSource = outcome.kind === "cache_hit_ok" || outcome.kind === "cache_hit_unavailable" ? "CACHE" : "GEMINI";
      emitAnalysisDuration(now.getTime() - new Date(message.savedAt).getTime(), analysisSource);
    }
  } catch (error) {
    const metricType = error instanceof GeminiCallError ? geminiErrorMetricType(error.kind) : undefined;

    if (error instanceof GeminiCallError && metricType) {
      emitGeminiError(metricType);
      logError("Fallo de Gemini", message.correlationId, error, { videoId: message.videoId, attempt: receiveCount });

      if (!isLastAttempt(receiveCount)) {
        await scheduleRetry(record.receiptHandle, receiveCount);
        // Se propaga a propósito: así SQS no borra el mensaje y vuelve a estar
        // visible tras el backoff que ya configuramos arriba.
        throw error;
      }

      // Último intento agotado: el worker se autorresuelve a NEEDS_INPUT, sin
      // esperar a que la cola llegue a maxReceiveCount y caiga a la DLQ.
      await markItemNeedsInput({ userId: message.userId, videoId: message.videoId, analysisError: "AI_ERROR", now });
      logInfo("Reintentos agotados, NEEDS_INPUT", message.correlationId, { videoId: message.videoId });
      return;
    }

    // Error no controlado (bug, DynamoDB caído, etc.): se propaga. La red de
    // seguridad es el redrive nativo de SQS + la Lambda DLQ.
    logError("Error no controlado procesando análisis", message.correlationId, error, { videoId: message.videoId });
    throw error;
  }
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    await processRecord(record);
  }
};
