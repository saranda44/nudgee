/**
 * E-06 GET /v1/items (listar / polling) y E-07 GET /v1/items/{videoId}
 * (Ítems).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { requireUserId, type Route, type HandlerContext } from "./router.ts";
import { ProblemError, buildProblemResponse, buildValidationErrorResponse } from "./problem.ts";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

// Cursor simplificado: base64url del SK (ITEM#videoId)
function encodeCursor(sk: string): string {
  return Buffer.from(sk).toString("base64url");
}

function decodeCursor(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    // Validar que sea un SK válido (debe empezar con ITEM#)
    if (!decoded.startsWith("ITEM#")) {
      throw new Error("Invalid cursor format");
    }
    return decoded;
  } catch {
    throw new Error("Invalid cursor format");
  }
}

function parseLimit(limitStr: string | undefined, defaultLimit: number, max: number): number {
  if (!limitStr) return defaultLimit;
  const parsed = Number(limitStr);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`limit must be between 1 and ${max}`);
  }
  return parsed;
}

function parseIds(idsStr: string | undefined): string[] {
  if (!idsStr) return [];
  return idsStr
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

type Item = Record<string, unknown>;

export const itemRoutes: Route[] = [
  // E-06: Listar biblioteca / polling
  {
    method: "GET",
    path: "/v1/items",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { limit: limitStr, cursor: cursorStr, ids: idsStr } = ctx.event.queryStringParameters ?? {};

      // Validar que limit/cursor y ids sean excluyentes
      if ((limitStr || cursorStr) && idsStr) {
        return buildValidationErrorResponse(
          [{ pointer: "/query", code: "INVALID_QUERY", message: "ids and cursor/limit are mutually exclusive" }],
          ctx.correlationId,
        );
      }

      // Modo polling (BatchGetItem)
        if (idsStr) {
          const ids = parseIds(idsStr);
          if (ids.length === 0 || ids.length > 25) {
            return buildValidationErrorResponse(
              [{ pointer: "/query/ids", code: "INVALID_QUERY", message: "ids must have 1 to 25 items" }],
              ctx.correlationId,
            );
          }

          const keys = ids.map((videoId) => ({ PK: `USER#${userId}`, SK: `ITEM#${videoId}` }));
          const result = await docClient.send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys } } }));
          const items = (result.Responses?.[TABLE_NAME] ?? []) as Item[];

          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items, nextCursor: null }),
          };
        }

        // Modo listado (Query con cursor)
        let limit: number;
        let exclusiveStartKey: Record<string, unknown> | undefined;

        try {
          limit = parseLimit(limitStr, 50, 100);
        } catch (error) {
          return buildValidationErrorResponse(
            [{ pointer: "/query/limit", code: "INVALID_QUERY", message: (error as Error).message }],
            ctx.correlationId,
          );
        }

        if (cursorStr) {
          try {
            const decodedSk = decodeCursor(cursorStr);
            exclusiveStartKey = { PK: `USER#${userId}`, SK: decodedSk };
          } catch {
            return buildValidationErrorResponse(
              [{ pointer: "/query/cursor", code: "INVALID_CURSOR", message: "cursor is not valid" }],
              ctx.correlationId,
            );
          }
        }

        const result = await docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "attribute_not_exists(expiresAt) OR expiresAt > :now",
            ExpressionAttributeValues: {
              ":pk": `USER#${userId}`,
              ":sk": "ITEM#",
              ":now": Math.floor(Date.now() / 1000),
            },
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );

        const items = (result.Items ?? []) as Item[];
        const nextCursor = result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey.SK as string) : null;

        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, nextCursor }),
        };
    },
  },

  // E-07: Ver tarjeta
  {
    method: "GET",
    path: "/v1/items/:videoId",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
        }),
      );

      if (!result.Item) {
        return buildProblemResponse(
          new ProblemError({
            status: 404,
            code: "ITEM_NOT_FOUND",
            title: "Item not found",
          }),
          ctx.correlationId,
        );
      }

      const item = result.Item as Item;
      const version = item.version as number | undefined;

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          ...(version ? { ETag: `"${version}"` } : {}),
        },
        body: JSON.stringify(item),
      };
    },
  },
];
