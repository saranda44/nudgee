/**
 * E-10 a E-17: Transiciones de estado (done, undo-done, snooze, reschedule,
 * discard, restore, reactivate, delete). RF §4.3–4.5, T-05…T-11.
 *
 * Todas son escrituras condicionales sobre `status` + `version` (API-02). Una falla
 * condicional se traduce a 404 (no existe o expiró), 412 (versión) o 409 (estado).
 */

import { DynamoDBClient, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { readJsonBody, requireUserId, type Route, type HandlerContext } from "./router.ts";
import { ProblemError, buildValidationErrorResponse } from "./problem.ts";
import { itemResponse } from "./item-dto.ts";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

type Item = Record<string, unknown>;
type Status = "PROCESSING" | "NEEDS_INPUT" | "PENDING" | "DORMANT" | "DONE" | "DISCARDED";

// ── Configuración ────────────────────────────────────────────────────────────

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
  return parseCsv(process.env.SNOOZE_OPTIONS, ["1", "3", "5"]).map(Number);
}

function getSnoozeUnit(): "DAY" | "MINUTE" {
  return (process.env.SNOOZE_UNIT ?? "DAY") as "DAY" | "MINUTE";
}

function getDiscardRetentionDays(): number {
  return parseNumber(process.env.DISCARD_RETENTION_DAYS, 30);
}

/**
 * Valida que la fecha sea YYYY-MM-DD real, no esté en el pasado y no pase de 365 días.
 * Devuelve el error de validación o `null` si es válida.
 */
function validateScheduleDate(dateStr: string, userTimezone: string): { code: string; message: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { code: "INVALID_DATE", message: "must be in YYYY-MM-DD format" };
  }

  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { code: "INVALID_DATE", message: "must be a valid date" };
  }

  // "Hoy" en la zona del usuario
  const todayInUserTz = new Date(new Date().toLocaleString("en-US", { timeZone: userTimezone }));
  todayInUserTz.setHours(0, 0, 0, 0);
  if (date < todayInUserTz) {
    return { code: "DATE_IN_PAST", message: "must be today or later" };
  }

  const maxDate = new Date(todayInUserTz);
  maxDate.setDate(maxDate.getDate() + 365);
  if (date > maxDate) {
    return { code: "INVALID_DATE", message: "must be at most 365 days in the future" };
  }
  return null;
}

// ── Helpers de transición ────────────────────────────────────────────────────

function itemKey(userId: string, videoId: string) {
  return { PK: `USER#${userId}`, SK: `ITEM#${videoId}` };
}

/** GSI1 de pendientes: `{savedAt}#{videoId}`, del más viejo al más nuevo (US-39, D-08). */
function pendingIndexValues(userId: string, item: Item, videoId: string) {
  return { ":gsi1pk": `USER#${userId}`, ":gsi1sk": `${item.savedAt}#${videoId}` };
}
const SET_PENDING_INDEX = ["GSI1PK = :gsi1pk", "GSI1SK = :gsi1sk"];
const REMOVE_PENDING_INDEX = ["GSI1PK", "GSI1SK"];

/** Lee `If-Match`: ausente → 428; no numérico → 412 (nunca puede coincidir). */
function readIfMatch(ctx: HandlerContext): number {
  const header = ctx.event.headers?.["if-match"];
  if (!header) {
    throw new ProblemError({ status: 428, code: "PRECONDITION_REQUIRED", title: "If-Match header is required" });
  }
  const raw = header.replace(/"/g, "").trim();
  if (!/^\d+$/.test(raw)) {
    throw new ProblemError({ status: 412, code: "VERSION_MISMATCH", title: "Item was modified" });
  }
  return Number(raw);
}

function isExpired(item: Item): boolean {
  return typeof item.expiresAt === "number" && item.expiresAt <= Math.floor(Date.now() / 1000);
}

/** Lanza 404/412/409 si el ítem no permite la acción con esa versión (RF §4.4). */
function assertTransition(
  item: Item | undefined,
  version: number,
  action: string,
  allowed: Status[],
): asserts item is Item {
  if (!item || isExpired(item)) {
    throw new ProblemError({ status: 404, code: "ITEM_NOT_FOUND", title: "Item not found" });
  }
  if (item.version !== version) {
    throw new ProblemError({
      status: 412,
      code: "VERSION_MISMATCH",
      title: "Item was modified",
      extensions: { currentVersion: item.version },
    });
  }
  if (!allowed.includes(item.status as Status)) {
    throw new ProblemError({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
      title: "Action not allowed in the current status",
      extensions: { action, currentStatus: item.status, allowedStatuses: allowed },
    });
  }
}

/**
 * Traduce ConditionalCheckFailedException (con `Item` = ALL_OLD) a 404/412/409.
 * El DocumentClient no convierte el `Item` de la excepción: llega en formato
 * AttributeValue (`{ N: "2" }`) y hay que hacer `unmarshall`.
 */
function rethrowConditionalFailure(error: unknown, version: number, action: string, allowed: Status[]): never {
  if ((error as { name?: string })?.name !== "ConditionalCheckFailedException") throw error;
  const rawItem = (error as { Item?: Record<string, AttributeValue> }).Item;
  const oldItem = rawItem ? (unmarshall(rawItem) as Item) : undefined;
  assertTransition(oldItem, version, action, allowed);
  // El ítem actual sí permite la acción: alguien lo cambió entre la condición y la lectura.
  throw new ProblemError({ status: 412, code: "VERSION_MISMATCH", title: "Item was modified" });
}

/** Condición común: estado permitido + versión esperada. */
function transitionCondition(allowed: Status[], version: number) {
  const placeholders = allowed.map((_, i) => `:from${i}`);
  const values: Record<string, unknown> = { ":v": version };
  allowed.forEach((status, i) => (values[placeholders[i]] = status));
  return { expression: `#s IN (${placeholders.join(", ")}) AND #v = :v`, values };
}

async function getItem(userId: string, videoId: string): Promise<Item | undefined> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: itemKey(userId, videoId), ConsistentRead: true }),
  );
  return result.Item;
}

interface UpdateSpec {
  ctx: HandlerContext;
  version: number;
  action: string;
  allowed: Status[];
  now: Date;
  /** Asignaciones extra (`statusUpdatedAt` y `version` se agregan solas). */
  set: string[];
  remove?: string[];
  values: Record<string, unknown>;
}

/** UpdateItem condicional que sube `version` y responde 200 con el ítem y su ETag. */
async function updateItem(spec: UpdateSpec): Promise<APIGatewayProxyStructuredResultV2> {
  const userId = requireUserId(spec.ctx);
  const condition = transitionCondition(spec.allowed, spec.version);
  const set = [...spec.set, "statusUpdatedAt = :now", "#v = :newVersion"];
  const remove = spec.remove ?? [];

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: itemKey(userId, spec.ctx.params.videoId),
        UpdateExpression: `SET ${set.join(", ")}` + (remove.length ? ` REMOVE ${remove.join(", ")}` : ""),
        ConditionExpression: condition.expression,
        ExpressionAttributeNames: { "#s": "status", "#v": "version" },
        ExpressionAttributeValues: {
          ...spec.values,
          ...condition.values,
          ":newVersion": spec.version + 1,
          ":now": spec.now.toISOString(),
        },
        ReturnValues: "ALL_NEW",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    return itemResponse(result.Attributes as Item);
  } catch (error) {
    rethrowConditionalFailure(error, spec.version, spec.action, spec.allowed);
  }
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export const transitionRoutes: Route[] = [
  // E-10 / T-05: Marcar hecho (PENDING → DONE)
  {
    method: "POST",
    path: "/v1/items/:videoId/done",
    auth: true,
    handler: async (ctx) =>
      updateItem({
        ctx,
        version: readIfMatch(ctx),
        action: "done",
        allowed: ["PENDING"],
        now: new Date(),
        set: ["#s = :to"],
        remove: REMOVE_PENDING_INDEX,
        values: { ":to": "DONE" },
      }),
  },

  // E-11 / T-06: Deshacer hecho (DONE → PENDING). Lee el ítem para recuperar savedAt.
  {
    method: "POST",
    path: "/v1/items/:videoId/undo-done",
    auth: true,
    handler: async (ctx) => {
      const userId = requireUserId(ctx);
      const version = readIfMatch(ctx);
      const allowed: Status[] = ["DONE"];
      const item = await getItem(userId, ctx.params.videoId);
      assertTransition(item, version, "undo-done", allowed);

      return updateItem({
        ctx,
        version,
        action: "undo-done",
        allowed,
        now: new Date(),
        set: ["#s = :to", ...SET_PENDING_INDEX],
        values: { ":to": "PENDING", ...pendingIndexValues(userId, item, ctx.params.videoId) },
      });
    },
  },

  // E-12: Posponer (PENDING + snoozeUntil; borra scheduledFor, RF §4.5)
  {
    method: "POST",
    path: "/v1/items/:videoId/snooze",
    auth: true,
    handler: async (ctx) => {
      const version = readIfMatch(ctx);
      const { days } = readJsonBody(ctx);

      const snoozeOptions = getSnoozeOptions();
      if (typeof days !== "number" || !snoozeOptions.includes(days)) {
        return buildValidationErrorResponse(
          [{ pointer: "/days", code: "ENUM", message: `must be one of ${snoozeOptions.join(", ")}` }],
          ctx.correlationId,
        );
      }

      const now = new Date();
      const snoozeUntil = new Date(now);
      if (getSnoozeUnit() === "DAY") {
        snoozeUntil.setDate(snoozeUntil.getDate() + days);
      } else {
        snoozeUntil.setMinutes(snoozeUntil.getMinutes() + days);
      }

      return updateItem({
        ctx,
        version,
        action: "snooze",
        allowed: ["PENDING"],
        now,
        set: ["snoozeUntil = :snoozeUntil", "snoozeCount = if_not_exists(snoozeCount, :zero) + :inc"],
        remove: ["scheduledFor"],
        values: { ":snoozeUntil": snoozeUntil.toISOString(), ":zero": 0, ":inc": 1 },
      });
    },
  },

  // E-13: Reprogramar (PENDING + scheduledFor; borra snoozeUntil, RF §4.5)
  {
    method: "POST",
    path: "/v1/items/:videoId/reschedule",
    auth: true,
    handler: async (ctx) => {
      const version = readIfMatch(ctx);
      const { date } = readJsonBody(ctx);

      if (typeof date !== "string") {
        return buildValidationErrorResponse(
          [{ pointer: "/date", code: "INVALID_TYPE", message: "must be a string" }],
          ctx.correlationId,
        );
      }

      // TODO: obtener timezone del usuario desde el perfil
      const dateError = validateScheduleDate(date, "America/Mexico_City");
      if (dateError) {
        return buildValidationErrorResponse([{ pointer: "/date", ...dateError }], ctx.correlationId);
      }

      return updateItem({
        ctx,
        version,
        action: "reschedule",
        allowed: ["PENDING"],
        now: new Date(),
        set: ["scheduledFor = :date"],
        remove: ["snoozeUntil"],
        values: { ":date": date },
      });
    },
  },

  // E-14 / T-09: Descartar (PENDING|NEEDS_INPUT|DORMANT → DISCARDED), TTL en expiresAt
  {
    method: "POST",
    path: "/v1/items/:videoId/discard",
    auth: true,
    handler: async (ctx) => {
      const now = new Date();
      const expiresAt = Math.floor(now.getTime() / 1000) + getDiscardRetentionDays() * 24 * 60 * 60;
      return updateItem({
        ctx,
        version: readIfMatch(ctx),
        action: "discard",
        allowed: ["PENDING", "NEEDS_INPUT", "DORMANT"],
        now,
        set: ["#s = :to", "expiresAt = :expiresAt"],
        remove: REMOVE_PENDING_INDEX,
        values: { ":to": "DISCARDED", ":expiresAt": expiresAt },
      });
    },
  },

  // E-15 / T-10: Restaurar (DISCARDED → PENDING, o NEEDS_INPUT si nunca tuvo datos).
  // Lee el ítem para decidir el destino según dataSource y recuperar savedAt.
  {
    method: "POST",
    path: "/v1/items/:videoId/restore",
    auth: true,
    handler: async (ctx) => {
      const userId = requireUserId(ctx);
      const version = readIfMatch(ctx);
      const allowed: Status[] = ["DISCARDED"];
      const item = await getItem(userId, ctx.params.videoId);
      assertTransition(item, version, "restore", allowed);

      const toPending = Boolean(item.dataSource);
      return updateItem({
        ctx,
        version,
        action: "restore",
        allowed,
        now: new Date(),
        set: ["#s = :to", "notifyCount = :zero", "snoozeCount = :zero", ...(toPending ? SET_PENDING_INDEX : [])],
        remove: ["expiresAt"],
        values: {
          ":to": toPending ? "PENDING" : "NEEDS_INPUT",
          ":zero": 0,
          ...(toPending ? pendingIndexValues(userId, item, ctx.params.videoId) : {}),
        },
      });
    },
  },

  // E-16 / T-08: Reactivar (DORMANT → PENDING). Lee el ítem para recuperar savedAt.
  {
    method: "POST",
    path: "/v1/items/:videoId/reactivate",
    auth: true,
    handler: async (ctx) => {
      const userId = requireUserId(ctx);
      const version = readIfMatch(ctx);
      const allowed: Status[] = ["DORMANT"];
      const item = await getItem(userId, ctx.params.videoId);
      assertTransition(item, version, "reactivate", allowed);

      return updateItem({
        ctx,
        version,
        action: "reactivate",
        allowed,
        now: new Date(),
        set: ["#s = :to", "notifyCount = :zero", ...SET_PENDING_INDEX],
        values: { ":to": "PENDING", ":zero": 0, ...pendingIndexValues(userId, item, ctx.params.videoId) },
      });
    },
  },

  // E-17 / T-11: Eliminar definitivo (DISCARDED → eliminado)
  {
    method: "DELETE",
    path: "/v1/items/:videoId",
    auth: true,
    handler: async (ctx) => {
      const userId = requireUserId(ctx);
      const version = readIfMatch(ctx);
      const allowed: Status[] = ["DISCARDED"];
      const condition = transitionCondition(allowed, version);

      try {
        await docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: itemKey(userId, ctx.params.videoId),
            ConditionExpression: condition.expression,
            ExpressionAttributeNames: { "#s": "status", "#v": "version" },
            ExpressionAttributeValues: condition.values,
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );
      } catch (error) {
        rethrowConditionalFailure(error, version, "delete", allowed);
      }
      return { statusCode: 204, headers: {}, body: "" };
    },
  },
];
