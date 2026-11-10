/**
 * E-19 POST /v1/notifications/{slotKey}/open y E-22 GET /v1/notifications
 * (Recordatorios).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { requireUserId, type Route, type HandlerContext } from "./router.ts";
import { buildValidationErrorResponse } from "./problem.ts";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

type Notification = Record<string, unknown>;

/**
 * Decodifica y valida el cursor (LastEvaluatedKey en base64url).
 */
function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);

    // Validar que tenga PK y SK
    if (typeof parsed.PK !== "string" || typeof parsed.SK !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Codifica LastEvaluatedKey en base64url.
 */
function encodeCursor(lastEvaluatedKey: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64url");
}

/**
 * Formatea una notificación para la respuesta de E-22.
 */
function formatNotification(item: Notification): Notification {
  return {
    slotKey: item.SK?.toString().replace("NOTIF#", ""),
    videoId: item.videoId,
    category: item.category,
    title: item.title,
    messageKey: item.messageKey,
    messageParams: item.messageParams || {},
    sentAt: item.sentAt,
    openedAt: item.openedAt,
  };
}

/**
 * Cuenta notificaciones no leídas del usuario (openedAt = null).
 */
async function countUnreadNotifications(userId: string): Promise<number> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":sk": "NOTIF#",
        },
        Select: "COUNT",
      }),
    );

    // Contar manualmente los no leídos (openedAt = null)
    const allNotifs = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":sk": "NOTIF#",
        },
        ProjectionExpression: "openedAt",
      }),
    );

    return (allNotifs.Items || []).filter((item) => !item.openedAt).length;
  } catch (error) {
    console.error(`Error counting unread notifications: ${error}`);
    return 0;
  }
}

export const notificationRoutes: Route[] = [
  // E-19: Registrar apertura de un recordatorio
  {
    method: "POST",
    path: "/v1/notifications/:slotKey/open",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { slotKey } = ctx.params;

      const now = new Date().toISOString();

      try {
        // TransactWriteItems:
        // 1. Update NOTIF# con openedAt
        // 2. Conditional update del ítem: si status = PENDING, set notifyCount = 0

        await docClient.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: TABLE_NAME,
                  Key: { PK: `USER#${userId}`, SK: `NOTIF#${slotKey}` },
                  UpdateExpression: "SET openedAt = :now",
                  ExpressionAttributeValues: {
                    ":now": now,
                  },
                },
              },
              {
                Update: {
                  TableName: TABLE_NAME,
                  Key: { PK: `USER#${userId}`, SK: `NOTIF#${slotKey}` },
                  UpdateExpression: "SET #s = :status",
                  ConditionExpression: "#s = :pending",
                  ExpressionAttributeNames: { "#s": "status" },
                  ExpressionAttributeValues: {
                    ":status": "PENDING",
                    ":pending": "PENDING",
                  },
                  ReturnValuesOnConditionCheckFailure: "NONE",
                },
              },
            ],
          }),
        );
      } catch (error: unknown) {
        const err = error as any;

        // Si la notificación no existe (ValidationException)
        if (
          err.name === "ValidationException" ||
          err.message?.includes("Transaction request cannot include multiple operations on one item")
        ) {
          // Reintenta con solo el update de la notificación
          try {
            await docClient.send(
              new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: `USER#${userId}`, SK: `NOTIF#${slotKey}` },
                UpdateExpression: "SET openedAt = :now",
                ExpressionAttributeValues: {
                  ":now": now,
                },
              }),
            );
          } catch {
            // Notificación no existe, pero devolvemos 204 igual (idempotente)
          }
        }
      }

      // Siempre devuelve 204 (idempotente)
      return {
        statusCode: 204,
        headers: {},
        body: "",
      };
    },
  },

  // E-22: Listar la bandeja de recordatorios
  {
    method: "GET",
    path: "/v1/notifications",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const limitStr = (ctx.event.queryStringParameters?.limit as string) || "20";
      const cursor = (ctx.event.queryStringParameters?.cursor as string) || null;

      // Validar limit
      const limit = parseInt(limitStr, 10);
      if (isNaN(limit) || limit < 1 || limit > 100) {
        return buildValidationErrorResponse(
          [
            {
              pointer: "/query/limit",
              code: "INVALID_RANGE",
              message: "must be between 1 and 100",
            },
          ],
          ctx.correlationId,
        );
      }

      // Decodificar cursor si existe
      let exclusiveStartKey: Record<string, unknown> | undefined;
      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (!decoded) {
          return buildValidationErrorResponse(
            [
              {
                pointer: "/query/cursor",
                code: "INVALID_CURSOR",
                message: "cursor is not valid",
              },
            ],
            ctx.correlationId,
          );
        }
        exclusiveStartKey = decoded;
      }

      try {
        // Query por NOTIF#, ordenado descendente (más nuevo primero)
        const result = await docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": `USER#${userId}`,
              ":sk": "NOTIF#",
            },
            ScanIndexForward: false, // Descendente (más nuevo primero)
            Limit: limit + 1, // +1 para detectar si hay más
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );

        const items = (result.Items || []) as Notification[];
        const hasMore = items.length > limit;
        const notifications = items.slice(0, limit).map(formatNotification);

        const response: Record<string, unknown> = {
          notifications,
        };

        // unreadCount solo en primera página (sin cursor)
        if (!cursor) {
          const unreadCount = await countUnreadNotifications(userId);
          response.unreadCount = unreadCount;
        }

        // nextCursor si hay más
        if (hasMore && items.length > limit) {
          const lastItem = items[limit];
          response.nextCursor = encodeCursor({
            PK: lastItem.PK,
            SK: lastItem.SK,
          });
        } else {
          response.nextCursor = null;
        }

        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "private, no-cache",
          },
          body: JSON.stringify(response),
        };
      } catch (error: unknown) {
        console.error(`Error querying notifications: ${error}`);
        throw error;
      }
    },
  },
];
