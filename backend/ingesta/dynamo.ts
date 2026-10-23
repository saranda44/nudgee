/**
 * Guardado del ítem + cuota (dedupe atómica) en una sola TransactWriteItems.
 */

import {
  DynamoDBClient,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const ddbClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const HOUR_LIMIT = 30;
const DAY_LIMIT = 100;
/** Reintentos ante choque de transacciones simultáneas idénticas */
const MAX_TRANSACTION_CONFLICT_RETRIES = 3;

interface QuotaWindow {
  sk: string;
  label: "HOUR" | "DAY";
  limit: number;
  /** Epoch (s) del fin de la ventana, para Retry-After. */
  windowEndEpochSeconds: number;
  /** TTL del contador: fin de la ventana + 1 h */
  expiresAt: number;
}

function computeHourWindow(now: Date): QuotaWindow {
  const sk = `QUOTA#HOUR#${now.toISOString().slice(0, 13)}`; // 2026-10-13T15
  const windowStart = new Date(now);
  windowStart.setUTCMinutes(0, 0, 0);
  const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);
  return {
    sk,
    label: "HOUR",
    limit: HOUR_LIMIT,
    windowEndEpochSeconds: Math.floor(windowEnd.getTime() / 1000),
    expiresAt: Math.floor(windowEnd.getTime() / 1000) + 60 * 60,
  };
}

function computeDayWindow(now: Date): QuotaWindow {
  const sk = `QUOTA#DAY#${now.toISOString().slice(0, 10)}`; // 2026-10-13
  const windowStart = new Date(now);
  windowStart.setUTCHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
  return {
    sk,
    label: "DAY",
    limit: DAY_LIMIT,
    windowEndEpochSeconds: Math.floor(windowEnd.getTime() / 1000),
    expiresAt: Math.floor(windowEnd.getTime() / 1000) + 60 * 60,
  };
}

export interface SaveItemInput {
  userId: string;
  videoId: string;
  sourceUrl: string;
  thumbnailUrl: string;
  correlationId: string;
  now: Date;
}

export interface ExistingItemSummary {
  videoId: string;
  status: string;
  title: string | null;
  /** Para la decisión de reencolado; no se expone en la respuesta 409. */
  savedAt: string;
}

export type SaveOutcome =
  | { kind: "created"; version: number; savedAt: string; statusUpdatedAt: string }
  | { kind: "duplicate"; existing: ExistingItemSummary }
  | { kind: "quota_exceeded"; window: "HOUR" | "DAY"; limit: number; retryAfterSeconds: number };

function quotaUpdateCommandInput(pk: string, userId: string, window: QuotaWindow) {
  return {
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: window.sk },
    UpdateExpression:
      "SET #window = if_not_exists(#window, :window), entityType = if_not_exists(entityType, :entityType), " +
      "userId = if_not_exists(userId, :userId), expiresAt = if_not_exists(expiresAt, :expiresAt) " +
      "ADD #count :increment",
    ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
    ExpressionAttributeNames: { "#window": "window", "#count": "count" },
    ExpressionAttributeValues: {
      ":window": window.label,
      ":entityType": "QUOTA_COUNTER",
      ":userId": userId,
      ":expiresAt": window.expiresAt,
      ":increment": 1,
      ":limit": window.limit,
    },
    ReturnValuesOnConditionCheckFailure: "ALL_OLD" as const,
  };
}

/**
 * Ejecuta la TransactWriteItems: Put del ítem en PROCESSING (dedupe) +
 * Update de cuota por hora + Update de cuota por día. Reintenta sola ante
 * TransactionConflictException (solicitudes idénticas simultáneas); cualquier
 * otro fallo de DynamoDB se propaga para que el handler responda 503.
 */
export async function saveItemWithQuota(input: SaveItemInput): Promise<SaveOutcome> {
  const { userId, videoId, sourceUrl, thumbnailUrl, correlationId, now } = input;
  const pk = `USER#${userId}`;
  const hourWindow = computeHourWindow(now);
  const dayWindow = computeDayWindow(now);
  const nowIso = now.toISOString();

  const command = new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: pk,
            SK: `ITEM#${videoId}`,
            entityType: "ITEM",
            userId,
            videoId,
            sourceUrl,
            thumbnailUrl,
            status: "PROCESSING",
            savedAt: nowIso,
            statusUpdatedAt: nowIso,
            snoozeCount: 0,
            notifyCount: 0,
            correlationId,
            version: 1,
          },
          ConditionExpression: "attribute_not_exists(PK)",
          ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
      },
      { Update: quotaUpdateCommandInput(pk, userId, hourWindow) },
      { Update: quotaUpdateCommandInput(pk, userId, dayWindow) },
    ],
  });

  for (let attempt = 1; attempt <= MAX_TRANSACTION_CONFLICT_RETRIES; attempt++) {
    try {
      await docClient.send(command);
      return { kind: "created", version: 1, savedAt: nowIso, statusUpdatedAt: nowIso };
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) {
        throw error; // DynamoDB caído u otro error de infra -> 503 en el handler
      }

      const reasons = error.CancellationReasons ?? [];
      const [itemReason, hourReason, dayReason] = reasons;

      if (itemReason?.Code === "ConditionalCheckFailed") {
        const existingRaw = itemReason.Item ? unmarshall(itemReason.Item as Record<string, never>) : {};
        return {
          kind: "duplicate",
          existing: {
            videoId: existingRaw.videoId ?? videoId,
            status: existingRaw.status ?? "UNKNOWN",
            title: existingRaw.title ?? null,
            savedAt: existingRaw.savedAt ?? nowIso,
          },
        };
      }

      if (hourReason?.Code === "ConditionalCheckFailed") {
        return {
          kind: "quota_exceeded",
          window: "HOUR",
          limit: hourWindow.limit,
          retryAfterSeconds: Math.max(0, hourWindow.windowEndEpochSeconds - Math.floor(Date.now() / 1000)),
        };
      }

      if (dayReason?.Code === "ConditionalCheckFailed") {
        return {
          kind: "quota_exceeded",
          window: "DAY",
          limit: dayWindow.limit,
          retryAfterSeconds: Math.max(0, dayWindow.windowEndEpochSeconds - Math.floor(Date.now() / 1000)),
        };
      }

      // Ninguna condición falló explícitamente: fue un choque de transacción
      // (TransactionConflict) por solicitudes idénticas simultáneas. Backoff corto y reintenta.
      if (attempt === MAX_TRANSACTION_CONFLICT_RETRIES) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 20));
    }
  }

  // Inalcanzable: el bucle siempre retorna o lanza.
  throw new Error("saveItemWithQuota: retry loop exited unexpectedly");
}

/** Borra el ítem recién creado si falla el SendMessage posterior. */
export async function deleteItemCompensation(userId: string, videoId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
    }),
  );
}
