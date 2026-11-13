/**
 * Dispatcher: Lambda invocada por EventBridge Scheduler en cada franja (RF §5, Arquitectura §5.2).
 * Lee perfil, GSI1 y suscripciones (AP-12) → pasa a DORMANT los ignorados (AP-15) → registra
 * a lo más un recordatorio por franja de forma idempotente (AP-13) → Web Push → deliveryStatus.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import webpush from "web-push";
import { randomUUID } from "crypto";
import { loadConfig, planSlot, slotKeyFor, type Candidate } from "./engine.ts";
import { buildReminderMessage } from "./messages.ts";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const ssmClient = new SSMClient({});

const TABLE_NAME = process.env.TABLE_NAME!;

/** Intentos de registro por franja si los primeros candidatos cambiaron de estado. */
const MAX_REGISTER_ATTEMPTS = 5;
/** Tiempo que el push service retiene la push si el dispositivo está apagado. */
const PUSH_TTL_SECONDS = 4 * 60 * 60;

/** Input del schedule (api/profile.ts); Scheduler sustituye los `<aws.scheduler.*>`. */
export interface DispatcherEvent {
  userId?: string;
  scheduledTime?: string;
  correlationId?: string;
}

export type DispatchOutcome =
  | { result: "SENT"; slotKey: string; videoId: string; deliveryStatus: string; targetCount: number; successCount: number }
  | { result: "ALREADY_SENT" | "NO_CANDIDATES"; slotKey: string; dormant: number }
  | { result: "NO_PROFILE" | "INVALID_EVENT" };

type Level = "info" | "warn" | "error";
function log(level: Level, correlationId: string, message: string, extra: Record<string, unknown> = {}) {
  // Nunca email, nombre, endpoints ni llaves (NFR-08).
  console.log(JSON.stringify({ level, correlationId, message, ...extra }));
}

let vapidPrivateKeyCache: string | undefined;
async function getVapidPrivateKey(): Promise<string> {
  if (!vapidPrivateKeyCache) {
    const result = await ssmClient.send(
      new GetParameterCommand({ Name: "/nudgee/VAPID_PRIVATE_KEY", WithDecryption: true }),
    );
    const value = result.Parameter?.Value;
    if (!value) throw new Error("VAPID_PRIVATE_KEY vacío en SSM");
    vapidPrivateKeyCache = value;
  }
  return vapidPrivateKeyCache;
}

/** Todos los ítems PENDING del usuario (GSI1 disperso, Modelo §4.2). */
async function queryCandidates(userId: string): Promise<Candidate[]> {
  const items: Candidate[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `USER#${userId}` },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((page.Items ?? []) as Candidate[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function querySubscriptions(userId: string): Promise<Record<string, any>[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sub)",
      ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sub": "SUB#" },
    }),
  );
  return (result.Items ?? []) as Record<string, any>[];
}

/** AP-15 / T-07: PENDING con notifyCount ≥ máximo → DORMANT (sale de GSI1). */
async function markDormant(userId: string, candidate: Candidate, max: number, nowIso: string, correlationId: string) {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: `ITEM#${candidate.videoId}` },
        UpdateExpression:
          "SET #s = :dormant, statusUpdatedAt = :now, #v = #v + :one REMOVE GSI1PK, GSI1SK, snoozeUntil, scheduledFor",
        ConditionExpression: "#s = :pending AND notifyCount >= :max",
        ExpressionAttributeNames: { "#s": "status", "#v": "version" },
        ExpressionAttributeValues: { ":dormant": "DORMANT", ":pending": "PENDING", ":now": nowIso, ":one": 1, ":max": max },
      }),
    );
    log("info", correlationId, "Ítem pasa a DORMANT (T-07)", { videoId: candidate.videoId });
    return true;
  } catch (error: any) {
    if (error?.name === "ConditionalCheckFailedException") return false; // ya cambió: GSI1 desfasado
    throw error;
  }
}

function cancellationCodes(error: any): string[] {
  return (error?.CancellationReasons ?? []).map((r: any) => r?.Code ?? "None");
}

export const handler = async (event: DispatcherEvent): Promise<DispatchOutcome> => {
  const correlationId = event?.correlationId || randomUUID();
  const userId = event?.userId;
  const scheduledAt = event?.scheduledTime ? new Date(event.scheduledTime) : undefined;

  if (!userId || !scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    log("error", correlationId, "Evento inválido: falta userId o scheduledTime", { scheduledTime: event?.scheduledTime });
    return { result: "INVALID_EVENT" };
  }

  const config = loadConfig();
  const now = new Date();
  const nowIso = now.toISOString();

  // AP-12: contexto del usuario
  const profile = (
    await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `USER#${userId}`, SK: "PROFILE" } }))
  ).Item;
  if (!profile) {
    log("warn", correlationId, "Usuario sin PROFILE; no se envía nada", { userId });
    return { result: "NO_PROFILE" };
  }
  const timezone = typeof profile.timezone === "string" && profile.timezone ? profile.timezone : "UTC";
  const slotKey = slotKeyFor(scheduledAt, timezone);

  const [candidates, subscriptions] = await Promise.all([queryCandidates(userId), querySubscriptions(userId)]);
  const plan = planSlot(candidates, now, timezone, config);

  let dormant = 0;
  for (const c of plan.dormant) {
    if (await markDormant(userId, c, config.maxReminders, nowIso, correlationId)) dormant++;
  }

  log("info", correlationId, "Plan de la franja", {
    userId,
    slotKey,
    candidates: candidates.length,
    eligible: plan.ordered.length,
    dormant,
    subscriptions: subscriptions.length,
  });

  // AP-13: registrar a lo más un envío por franja; el primer candidato que siga PENDING gana.
  const expiresAt = Math.floor(now.getTime() / 1000) + Number(process.env.NOTIFICATION_TTL_DAYS || 30) * 86400;
  let chosen: { videoId: string; pushTitle: string; pushBody: string } | undefined;

  for (const candidate of plan.ordered.slice(0, MAX_REGISTER_ATTEMPTS)) {
    const item = (
      await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `ITEM#${candidate.videoId}` },
          ConsistentRead: true,
        }),
      )
    ).Item;
    if (!item || item.status !== "PENDING") continue;

    const message = buildReminderMessage(item);
    // Un reprogramado se "consume" al recordarse; si no, conservaría la prioridad para siempre.
    const consumeSchedule = typeof item.scheduledFor === "string";

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE_NAME,
                Item: {
                  PK: `USER#${userId}`,
                  SK: `NOTIF#${slotKey}`,
                  entityType: "NOTIFICATION",
                  slotKey,
                  videoId: candidate.videoId,
                  category: item.category ?? null,
                  title: message.itemTitle,
                  messageKey: message.messageKey,
                  messageParams: message.messageParams,
                  scheduledAt: scheduledAt.toISOString(),
                  sentAt: nowIso,
                  // Sin suscripciones solo existe en la bandeja (NTF-01); con ellas se corrige tras el push.
                  deliveryStatus: subscriptions.length > 0 ? "FAILED" : "IN_APP",
                  targetCount: subscriptions.length,
                  successCount: 0,
                  correlationId,
                  expiresAt,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Update: {
                TableName: TABLE_NAME,
                Key: { PK: `USER#${userId}`, SK: `ITEM#${candidate.videoId}` },
                UpdateExpression:
                  "SET notifyCount = if_not_exists(notifyCount, :zero) + :one, lastNotifiedAt = :now" +
                  (consumeSchedule ? " REMOVE scheduledFor" : ""),
                ConditionExpression: "#s = :pending AND #v = :version",
                ExpressionAttributeNames: { "#s": "status", "#v": "version" },
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":now": nowIso,
                  ":pending": "PENDING",
                  ":version": item.version,
                },
              },
            },
          ],
        }),
      );
      chosen = { videoId: candidate.videoId, pushTitle: message.pushTitle, pushBody: message.pushBody };
      break;
    } catch (error: any) {
      if (error?.name !== "TransactionCanceledException") throw error;
      const [notifCode, itemCode] = cancellationCodes(error);
      if (notifCode === "ConditionalCheckFailed") {
        // El schedule se disparó dos veces para la misma franja: ya hay un envío registrado.
        log("info", correlationId, "Franja ya registrada; termina sin reenviar", { userId, slotKey });
        return { result: "ALREADY_SENT", slotKey, dormant };
      }
      if (itemCode === "ConditionalCheckFailed") {
        log("info", correlationId, "El ítem cambió entre la lectura y el registro; siguiente candidato", {
          videoId: candidate.videoId,
        });
        continue;
      }
      throw error;
    }
  }

  if (!chosen) {
    log("info", correlationId, "Sin candidatos elegibles en la franja", { userId, slotKey });
    return { result: "NO_CANDIDATES", slotKey, dormant };
  }

  // Web Push (solo si hay suscripciones; la bandeja ya tiene el registro)
  let successCount = 0;
  if (subscriptions.length > 0) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:soporte@nudgee.app",
      process.env.VAPID_PUBLIC_KEY!,
      await getVapidPrivateKey(),
    );
    const payload = JSON.stringify({
      v: 1,
      type: "REMINDER",
      slotKey,
      videoId: chosen.videoId,
      title: chosen.pushTitle,
      body: chosen.pushBody,
      icon: "/icons/icon-192.png",
      url: `/items/${encodeURIComponent(chosen.videoId)}?slot=${encodeURIComponent(slotKey)}`,
      correlationId,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: PUSH_TTL_SECONDS }),
      ),
    );

    for (const [i, outcome] of results.entries()) {
      const sub = subscriptions[i];
      if (outcome.status === "fulfilled") {
        successCount++;
        continue;
      }
      const statusCode = (outcome.reason as any)?.statusCode;
      log("warn", correlationId, "Falló el Web Push", { subscriptionId: sub.subscriptionId, statusCode });
      if (statusCode === 404 || statusCode === 410) {
        // Suscripción expirada (AP-11, NFR-04)
        await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: sub.PK, SK: sub.SK } }));
        log("info", correlationId, "Suscripción expirada eliminada", { subscriptionId: sub.subscriptionId });
      }
    }
  }

  const deliveryStatus =
    subscriptions.length === 0
      ? "IN_APP"
      : successCount === subscriptions.length
        ? "SENT"
        : successCount > 0
          ? "PARTIAL"
          : "FAILED";

  if (subscriptions.length > 0) {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: `NOTIF#${slotKey}` },
        UpdateExpression: "SET deliveryStatus = :status, successCount = :ok",
        ExpressionAttributeValues: { ":status": deliveryStatus, ":ok": successCount },
      }),
    );
  }

  log("info", correlationId, "Recordatorio registrado", {
    userId,
    slotKey,
    videoId: chosen.videoId,
    deliveryStatus,
    targetCount: subscriptions.length,
    successCount,
    delayMs: now.getTime() - scheduledAt.getTime(),
  });

  return {
    result: "SENT",
    slotKey,
    videoId: chosen.videoId,
    deliveryStatus,
    targetCount: subscriptions.length,
    successCount,
  };
};
