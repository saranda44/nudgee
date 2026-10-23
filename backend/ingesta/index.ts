import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { randomUUID } from "crypto";
import { parseShortsUrl } from "./url";
import { ProblemError, buildInternalErrorResponse, buildProblemResponse } from "./problem";
import { deleteItemCompensation, saveItemWithQuota } from "./dynamo";
import { sendAnalysisMessage } from "./sqs";

const MAX_BODY_BYTES = 32 * 1024;
/** un ítem en PROCESSING más viejo que esto se considera atascado. */
const STUCK_PROCESSING_MS = 60 * 1000;

function logError(message: string, correlationId: string, error: unknown): void {
  console.error(JSON.stringify({ level: "error", correlationId, message, error: String(error) }));
}

function getCorrelationId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const header = event.headers?.["x-correlation-id"];
  return header && header.length > 0 ? header : randomUUID();
}

function getUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  // Authorizer JWT de API Gateway: el userId siempre es el `sub` del access token.
  const sub = event.requestContext.authorizer.jwt.claims.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Missing sub claim: la ruta debe estar protegida por el authorizer JWT");
  }
  return sub;
}

function buildCreatedResponse(params: {
  videoId: string;
  sourceUrl: string;
  thumbnailUrl: string;
  savedAt: string;
  statusUpdatedAt: string;
  version: number;
  correlationId: string;
}): APIGatewayProxyStructuredResultV2 {
  const { videoId, sourceUrl, thumbnailUrl, savedAt, statusUpdatedAt, version, correlationId } = params;
  return {
    statusCode: 202,
    headers: {
      "Content-Type": "application/json",
      Location: `/v1/items/${videoId}`,
      ETag: `"${version}"`,
      "X-Correlation-Id": correlationId,
    },
    body: JSON.stringify({
      videoId,
      sourceUrl,
      thumbnailUrl,
      status: "PROCESSING",
      category: null,
      title: null,
      summary: null,
      details: null,
      checklist: {},
      confidence: null,
      dataSource: null,
      analysisSource: null,
      analysisError: null,
      savedAt,
      readyAt: null,
      statusUpdatedAt,
      snoozeUntil: null,
      scheduledFor: null,
      snoozeCount: 0,
      suggestDiscard: false,
      suggestDone: false,
      notifyCount: 0,
      lastNotifiedAt: null,
      expiresAt: null,
      version,
    }),
  };
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const correlationId = getCorrelationId(event);

  try {
    const userId = getUserId(event);

    const rawBody = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : event.body;

    if (rawBody && Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return buildProblemResponse(
        new ProblemError({ status: 413, code: "PAYLOAD_TOO_LARGE", title: "Request body too large" }),
        correlationId,
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return buildProblemResponse(
        new ProblemError({ status: 400, code: "INVALID_JSON", title: "Request body is not valid JSON" }),
        correlationId,
      );
    }

    const url = (parsedBody as { url?: unknown })?.url;
    const parsed = parseShortsUrl(url);
    if (!parsed) {
      return buildProblemResponse(
        new ProblemError({
          status: 400,
          code: "INVALID_URL",
          title: "Invalid YouTube Shorts URL",
          detail: "Only https://youtube.com/shorts/{videoId} links are supported.",
        }),
        correlationId,
      );
    }

    const { videoId, sourceUrl, thumbnailUrl } = parsed;
    const now = new Date();

    let outcome;
    try {
      outcome = await saveItemWithQuota({ userId, videoId, sourceUrl, thumbnailUrl, correlationId, now });
    } catch (error) {
      // DynamoDB no disponible o choque de transacción no resuelto tras los reintentos.
      logError("saveItemWithQuota failed", correlationId, error);
      return buildProblemResponse(
        new ProblemError({ status: 503, code: "SERVICE_UNAVAILABLE", title: "Service unavailable" }),
        correlationId,
      );
    }

    if (outcome.kind === "quota_exceeded") {
      return buildProblemResponse(
        new ProblemError({
          status: 429,
          code: "QUOTA_EXCEEDED",
          title: "Save quota exceeded",
          headers: { "Retry-After": String(outcome.retryAfterSeconds) },
          extensions: { window: outcome.window, limit: outcome.limit, retryAfterSeconds: outcome.retryAfterSeconds },
        }),
        correlationId,
      );
    }

    if (outcome.kind === "duplicate") {
      const { existing } = outcome;

      // reencolar si el guardado original pudo interrumpirse entre la
      // transacción y el SendMessage (el ítem sigue en PROCESSING hace > 60 s).
      const ageMs = now.getTime() - new Date(existing.savedAt).getTime();
      if (existing.status === "PROCESSING" && ageMs > STUCK_PROCESSING_MS) {
        try {
          await sendAnalysisMessage({ userId, videoId, correlationId, savedAt: existing.savedAt });
        } catch (error) {
          // El reencolado es una red de seguridad best-effort; no debe romper la respuesta 409 normal.
          logError("ARQ-15 requeue failed", correlationId, error);
        }
      }

      return buildProblemResponse(
        new ProblemError({
          status: 409,
          code: "DUPLICATE_ITEM",
          title: "Video already saved",
          extensions: { existing: { videoId: existing.videoId, status: existing.status, title: existing.title } },
        }),
        correlationId,
      );
    }

    // outcome.kind === "created"
    try {
      await sendAnalysisMessage({ userId, videoId, correlationId, savedAt: outcome.savedAt });
    } catch (error) {
      logError("sendAnalysisMessage failed, compensating", correlationId, error);
      await deleteItemCompensation(userId, videoId).catch((compensationError) => {
        // Si también falla el borrado, queda un ítem huérfano en PROCESSING; el reencolado
        // lo detectará como atascado en el siguiente intento del mismo video.
        logError("deleteItemCompensation also failed", correlationId, compensationError);
      });
      return buildProblemResponse(
        new ProblemError({ status: 503, code: "SERVICE_UNAVAILABLE", title: "Service unavailable" }),
        correlationId,
      );
    }

    return buildCreatedResponse({
      videoId,
      sourceUrl,
      thumbnailUrl,
      savedAt: outcome.savedAt,
      statusUpdatedAt: outcome.statusUpdatedAt,
      version: outcome.version,
      correlationId,
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", correlationId, message: "Unhandled error in ingesta", error: String(error) }));
    return buildInternalErrorResponse(correlationId);
  }
};
