/**
 * Consumidor de la DLQ FIFO: el análisis agotó sus reintentos → NEEDS_INPUT + RETRIES_EXHAUSTED.
 * Emite `AnalysisDeadLettered` por mensaje (alarma > 0, NFR-10): la cola se vacía casi al
 * instante, así que su profundidad no sirve para alarmar (Arquitectura §4.8).
 */

import type { SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { emitMetrics } from "../shared/emf.ts";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

type Level = "info" | "warn" | "error";
function log(level: Level, correlationId: string, message: string, extra: Record<string, unknown> = {}) {
  // Nunca email, nombre ni el cuerpo completo del mensaje (NFR-08).
  console.log(JSON.stringify({ level, correlationId, message, ...extra }));
}

function parseBody(body: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    // Cuenta todo lo que llegó a la DLQ, incluso malformado: igual es un análisis perdido.
    emitMetrics([{ name: "AnalysisDeadLettered", value: 1, unit: "Count" }]);

    const body = parseBody(record.body);
    const correlationId = typeof body?.correlationId === "string" ? body.correlationId : record.messageId;
    const videoId = body?.videoId;
    const userId = body?.userId;

    if (typeof videoId !== "string" || typeof userId !== "string" || !videoId || !userId) {
      log("error", correlationId, "Mensaje malformado en DLQ", { messageId: record.messageId });
      continue;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
          UpdateExpression: "SET #st = :status, analysisError = :error, statusUpdatedAt = :now",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":status": "NEEDS_INPUT",
            ":error": "RETRIES_EXHAUSTED",
            ":now": new Date().toISOString(),
          },
        }),
      );
      log("info", correlationId, "Ítem marcado como NEEDS_INPUT (RETRIES_EXHAUSTED)", { userId, videoId });
    } catch (error) {
      log("error", correlationId, "Error actualizando ítem desde la DLQ", { userId, videoId, error: String(error) });
    }
  }
};
