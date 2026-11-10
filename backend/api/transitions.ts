/**
 * E-10 a E-17: Transiciones de estado (done, undo-done, snooze, reschedule,
 * discard, restore, reactivate, delete).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { requireUserId, type Route, type HandlerContext } from "./router.ts";
import { ProblemError, buildProblemResponse, buildValidationErrorResponse } from "./problem.ts";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

type Item = Record<string, unknown>;

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSnoozeOptions(): number[] {
  const fallback: string[] = ["1", "3", "5"];
  const strs = parseCsv(process.env.SNOOZE_OPTIONS, fallback);
  return strs.map((s) => Number(s));
}

function getSnoozeUnit(): "DAY" | "MINUTE" {
  return (process.env.SNOOZE_UNIT ?? "DAY") as "DAY" | "MINUTE";
}

function getDiscardRetentionDays(): number {
  return parseNumber(process.env.DISCARD_RETENTION_DAYS, 30);
}

/**
 * Valida que la fecha sea válida, no esté en el pasado y no sea más de 365 días en el futuro.
 */
function validateScheduleDate(dateStr: string, userTimezone: string): { valid: boolean; error?: string } {
  // Parse YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, error: "must be in YYYY-MM-DD format" };
  }

  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  // Validar que sea una fecha válida
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { valid: false, error: "must be a valid date" };
  }

  // Obtener "hoy" en la zona del usuario
  const now = new Date();
  const todayInUserTz = new Date(now.toLocaleString("en-US", { timeZone: userTimezone }));
  todayInUserTz.setHours(0, 0, 0, 0);

  // Validar que no esté en el pasado
  if (date < todayInUserTz) {
    return { valid: false, error: "must be today or later" };
  }

  // Validar que no sea más de 365 días en el futuro
  const maxDate = new Date(todayInUserTz);
  maxDate.setDate(maxDate.getDate() + 365);
  if (date > maxDate) {
    return { valid: false, error: "must be at most 365 days in the future" };
  }

  return { valid: true };
}

export const transitionRoutes: Route[] = [
  // E-10: Marcar hecho (PENDING → DONE)
  {
    method: "POST",
    path: "/v1/items/:videoId/done",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      const now = new Date().toISOString();

      try {
        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression: "SET #s = :done, statusUpdatedAt = :now, #v = :newVersion REMOVE GSI1PK, GSI1SK",
            ConditionExpression: "#s = :pending AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":done": "DONE",
              ":v": version,
              ":newVersion": version + 1,
              ":now": now,
            },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const item = result.Attributes as Item;
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", ETag: `"${item.version}"` },
          body: JSON.stringify(item),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          const oldItem = (error as any).Item as Item | undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          }
          return buildProblemResponse(
            new ProblemError({
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              title: "Action not allowed in the current status",
              extensions: { action: "done", currentStatus: oldItem?.status, allowedStatuses: ["PENDING"] },
            }),
            ctx.correlationId,
          );
        }
        throw error;
      }
    },
  },

  // E-11: Deshacer hecho (DONE → PENDING)
  {
    method: "POST",
    path: "/v1/items/:videoId/undo-done",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      const now = new Date().toISOString();

      try {
        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression:
              "SET #s = :pending, statusUpdatedAt = :now, #v = :newVersion, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk",
            ConditionExpression: "#s = :done AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: {
              ":done": "DONE",
              ":pending": "PENDING",
              ":v": version,
              ":newVersion": version + 1,
              ":now": now,
              ":gsi1pk": `USER#${userId}`,
              ":gsi1sk": `:${now}#${videoId}`, // savedAt#videoId
            },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const item = result.Attributes as Item;
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", ETag: `"${item.version}"` },
          body: JSON.stringify(item),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          const oldItem = (error as any).Item as Item | undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          }
          return buildProblemResponse(
            new ProblemError({
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              title: "Action not allowed in the current status",
              extensions: { action: "undo-done", currentStatus: oldItem?.status, allowedStatuses: ["DONE"] },
            }),
            ctx.correlationId,
          );
        }
        throw error;
      }
    },
  },

  // E-12: Posponer (PENDING + snoozeUntil)
  {
    method: "POST",
    path: "/v1/items/:videoId/snooze",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      const body = ctx.event.body ? JSON.parse(ctx.event.body) : {};
      const { days } = body as { days?: unknown };

      const snoozeOptions: number[] = getSnoozeOptions();
      if (typeof days !== "number" || !snoozeOptions.includes(days as number)) {
        return buildValidationErrorResponse(
          [{ pointer: "/days", code: "ENUM", message: `must be one of ${snoozeOptions.join(", ")}` }],
          ctx.correlationId,
        );
      }

      const snoozeUnit = getSnoozeUnit();
      const now = new Date();
      const snoozeUntil = new Date(now);
      if (snoozeUnit === "DAY") {
        snoozeUntil.setDate(snoozeUntil.getDate() + days);
      } else {
        snoozeUntil.setMinutes(snoozeUntil.getMinutes() + days);
      }

      try {
        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression:
              "SET snoozeUntil = :snoozeUntil, snoozeCount = snoozeCount + :inc, statusUpdatedAt = :now, #v = :newVersion REMOVE scheduledFor",
            ConditionExpression: "#s = :pending AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":v": version,
              ":newVersion": version + 1,
              ":snoozeUntil": snoozeUntil.toISOString(),
              ":now": now.toISOString(),
              ":inc": 1,
            },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const item = result.Attributes as Item;
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", ETag: `"${item.version}"` },
          body: JSON.stringify(item),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          const oldItem = (error as any).Item as Item | undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          }
          return buildProblemResponse(
            new ProblemError({
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              title: "Action not allowed in the current status",
              extensions: { action: "snooze", currentStatus: oldItem?.status, allowedStatuses: ["PENDING"] },
            }),
            ctx.correlationId,
          );
        }
        throw error;
      }
    },
  },

  // E-13: Reprogramar (PENDING + scheduledFor)
  {
    method: "POST",
    path: "/v1/items/:videoId/reschedule",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      const body = ctx.event.body ? JSON.parse(ctx.event.body) : {};
      const { date } = body as { date?: unknown };

      if (typeof date !== "string") {
        return buildValidationErrorResponse([{ pointer: "/date", code: "INVALID_TYPE", message: "must be a string" }], ctx.correlationId);
      }

      // TODO: obtener timezone del usuario desde el perfil
      const userTimezone = "America/Mexico_City";
      const validation = validateScheduleDate(date, userTimezone);
      if (!validation.valid) {
        const errorCode = validation.error?.includes("past") ? "DATE_IN_PAST" : "INVALID_DATE";
        return buildValidationErrorResponse([{ pointer: "/date", code: errorCode, message: validation.error! }], ctx.correlationId);
      }

      const now = new Date().toISOString();

      try {
        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression: "SET scheduledFor = :date, statusUpdatedAt = :now, #v = :newVersion REMOVE snoozeUntil",
            ConditionExpression: "#s = :pending AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":v": version,
              ":newVersion": version + 1,
              ":date": date,
              ":now": now,
            },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const item = result.Attributes as Item;
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", ETag: `"${item.version}"` },
          body: JSON.stringify(item),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          const oldItem = (error as any).Item as Item | undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          }
          return buildProblemResponse(
            new ProblemError({
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              title: "Action not allowed in the current status",
              extensions: { action: "reschedule", currentStatus: oldItem?.status, allowedStatuses: ["PENDING"] },
            }),
            ctx.correlationId,
          );
        }
        throw error;
      }
    },
  },

  // E-14: Descartar (PENDING|NEEDS_INPUT|DORMANT → DISCARDED)
  {
    method: "POST",
    path: "/v1/items/:videoId/discard",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      const now = new Date();
      const retentionDays = getDiscardRetentionDays();
      const expiresAt = Math.floor(now.getTime() / 1000) + retentionDays * 24 * 60 * 60;

      try {
        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression: "SET #s = :discarded, expiresAt = :expiresAt, statusUpdatedAt = :now, #v = :newVersion REMOVE GSI1PK, GSI1SK",
            ConditionExpression: "#s IN (:pending, :needsInput, :dormant) AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":needsInput": "NEEDS_INPUT",
              ":dormant": "DORMANT",
              ":discarded": "DISCARDED",
              ":v": version,
              ":newVersion": version + 1,
              ":expiresAt": expiresAt,
              ":now": now.toISOString(),
            },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const item = result.Attributes as Item;
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", ETag: `"${item.version}"` },
          body: JSON.stringify(item),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          const oldItem = (error as any).Item as Item | undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          }
          return buildProblemResponse(
            new ProblemError({
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              title: "Action not allowed in the current status",
              extensions: { action: "discard", currentStatus: oldItem?.status, allowedStatuses: ["PENDING", "NEEDS_INPUT", "DORMANT"] },
            }),
            ctx.correlationId,
          );
        }
        throw error;
      }
    },
  },

  // E-15: Restaurar (DISCARDED → PENDING|NEEDS_INPUT)
  {
    method: "POST",
    path: "/v1/items/:videoId/restore",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      const now = new Date();

      try {
        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression:
              "SET #s = if_not_exists(dataSource, :null) = :null ? :needsInput : :pending, notifyCount = :zero, snoozeCount = :zero, statusUpdatedAt = :now, #v = :newVersion, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk REMOVE expiresAt",
            ConditionExpression: "#s = :discarded AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: {
              ":discarded": "DISCARDED",
              ":null": null,
              ":needsInput": "NEEDS_INPUT",
              ":pending": "PENDING",
              ":v": version,
              ":newVersion": version + 1,
              ":zero": 0,
              ":now": now.toISOString(),
              ":gsi1pk": `USER#${userId}`,
              ":gsi1sk": `${now.toISOString()}#${videoId}`,
            },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const item = result.Attributes as Item;
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", ETag: `"${item.version}"` },
          body: JSON.stringify(item),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          const oldItem = (error as any).Item as Item | undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          }
          return buildProblemResponse(
            new ProblemError({
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              title: "Action not allowed in the current status",
              extensions: { action: "restore", currentStatus: oldItem?.status, allowedStatuses: ["DISCARDED"] },
            }),
            ctx.correlationId,
          );
        }
        throw error;
      }
    },
  },

  // E-16: Reactivar (DORMANT → PENDING)
  {
    method: "POST",
    path: "/v1/items/:videoId/reactivate",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));
      const now = new Date();

      try {
        const result = await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            UpdateExpression: "SET #s = :pending, notifyCount = :zero, statusUpdatedAt = :now, #v = :newVersion, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk",
            ConditionExpression: "#s = :dormant AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: {
              ":dormant": "DORMANT",
              ":pending": "PENDING",
              ":v": version,
              ":newVersion": version + 1,
              ":zero": 0,
              ":now": now.toISOString(),
              ":gsi1pk": `USER#${userId}`,
              ":gsi1sk": `${now.toISOString()}#${videoId}`,
            },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );

        const item = result.Attributes as Item;
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", ETag: `"${item.version}"` },
          body: JSON.stringify(item),
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          const oldItem = (error as any).Item as Item | undefined;
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          }
          return buildProblemResponse(
            new ProblemError({
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              title: "Action not allowed in the current status",
              extensions: { action: "reactivate", currentStatus: oldItem?.status, allowedStatuses: ["DORMANT"] },
            }),
            ctx.correlationId,
          );
        }
        throw error;
      }
    },
  },

  // E-17: Eliminar definitivo (DISCARDED → deleted)
  {
    method: "DELETE",
    path: "/v1/items/:videoId",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { videoId } = ctx.params;
      const ifMatch = ctx.event.headers?.["if-match"];

      if (!ifMatch) {
        return buildProblemResponse(
          new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" }),
          ctx.correlationId,
        );
      }

      const version = Number(ifMatch.replace(/"/g, ""));

      try {
        await docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
            ConditionExpression: "#s = :discarded AND #v = :v",
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: { ":discarded": "DISCARDED", ":v": version },
          }),
        );

        return {
          statusCode: 204,
          headers: {},
          body: "",
        };
      } catch (error: unknown) {
        if ((error as any)?.name === "ConditionalCheckFailedException") {
          const oldItem = (error as any).Item as Item | undefined;
          if (!oldItem) {
            // El item no existe
            return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "ITEM_NOT_FOUND" }) };
          }
          if (oldItem?.version !== version) {
            return buildProblemResponse(
              new ProblemError({
                status: 412,
                code: "VERSION_MISMATCH",
                title: "Item was modified",
                extensions: { currentVersion: oldItem?.version },
              }),
              ctx.correlationId,
            );
          }
          return buildProblemResponse(
            new ProblemError({
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              title: "Action not allowed in the current status",
              extensions: { action: "delete", currentStatus: oldItem?.status, allowedStatuses: ["DISCARDED"] },
            }),
            ctx.correlationId,
          );
        }
        throw error;
      }
    },
  },
];
