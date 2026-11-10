/**
 * Dispatcher: Lambda disparada por EventBridge Scheduler
 * Lee ítems PENDING para un slotKey, arma notificaciones, envía Web Push y actualiza la bandeja.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import webpush from "web-push";
import { randomUUID } from "crypto";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const ssmClient = new SSMClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;

type Item = Record<string, unknown>;
type Notification = Record<string, unknown>;
type PushSubscription = Record<string, unknown>;

// Cache de VAPID private key
let vapidPrivateKeyCache: string | null = null;

/**
 * Obtiene el VAPID private key del SSM (caché por contenedor).
 */
async function getVapidPrivateKey(): Promise<string> {
  if (vapidPrivateKeyCache) return vapidPrivateKeyCache;

  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: "/nudgee/VAPID_PRIVATE_KEY",
      WithDecryption: true,
    }),
  );

  vapidPrivateKeyCache = result.Parameter?.Value || "";
  return vapidPrivateKeyCache;
}

/**
 * Query GSI1 para obtener ítems PENDING en un slot.
 */
async function queryPendingItems(slotKey: string, userId: string): Promise<Item[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :gsi1pk",
        ExpressionAttributeValues: {
          ":gsi1pk": `PENDING#${slotKey}`,
        },
      }),
    );

    // Filtrar por userId (el GSI1 no incluye el PK)
    return (result.Items || []).filter((item) => {
      const pk = item.PK as string;
      return pk === `USER#${userId}`;
    });
  } catch (error) {
    console.error(`Error querying GSI1 for slotKey ${slotKey}:`, error);
    return [];
  }
}

/**
 * Obtiene suscripciones push activas del usuario.
 */
async function getPushSubscriptions(userId: string): Promise<PushSubscription[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":sk": "SUB#",
        },
      }),
    );

    return (result.Items || []) as PushSubscription[];
  } catch (error) {
    console.error(`Error querying push subscriptions for user ${userId}:`, error);
    return [];
  }
}

/**
 * Calcula messageKey según la categoría.
 */
function calculateMessageKey(category: string | null, isList: boolean): string {
  if (isList) return "reminder.list";
  if (category) return `reminder.${category}`;
  return "reminder.OTHER";
}

/**
 * Calcula messageParams (remaining, total para listas).
 */
function calculateMessageParams(
  item: Item,
  isList: boolean,
): Record<string, number> {
  if (!isList) return {};

  const checklist = (item.checklist || {}) as Record<string, unknown>;
  const details = (item.details || {}) as Record<string, unknown>;
  const entries = (details.entries || []) as Array<{ id?: string }>;

  const total = entries.length;
  const remaining = entries.filter((e) => !checklist[e.id || ""]).length;

  return { remaining, total };
}

/**
 * Determina si una categoría es lista.
 */
function isCategoryList(category: string | null): boolean {
  return ["MOVIE_SERIES", "PLACE", "BOOK", "MUSIC", "PODCAST"].includes(
    category as string,
  );
}

/**
 * Arma la notificación para guardar en bandeja.
 */
function buildNotification(item: Item, slotKey: string): Notification {
  const category = item.category as string | null;
  const isList = isCategoryList(category);
  const messageKey = calculateMessageKey(category, isList);
  const messageParams = calculateMessageParams(item, isList);
  const now = new Date().toISOString();

  // TTL: 7 días (configurable)
  const ttlDays = parseInt(process.env.NOTIFICATION_TTL_DAYS || "7", 10);
  const expiresAt = Math.floor(new Date(now).getTime() / 1000) + ttlDays * 86400;

  const pk = item.PK as string;
  const userId = pk.split("#")[1];

  return {
    PK: `USER#${userId}`,
    SK: `NOTIF#${slotKey}`,
    videoId: item.videoId,
    category,
    title: item.title,
    messageKey,
    messageParams,
    sentAt: now,
    openedAt: null,
    expiresAt,
    entityType: "NOTIFICATION",
  };
}

/**
 * Plantillas de mensajes por categoría (es-MX).
 */
function getMessageTemplate(
  category: string | null,
  isList: boolean,
): { title: string; body: string } {
  const templates: Record<string, { title: string; body: string }> = {
    RECIPE: { title: "¿Hoy la cocinas?", body: "{title}" },
    ROUTINE: { title: "¿Hoy la haces?", body: "{title}" },
    TUTORIAL: { title: "¿Hoy lo intentas?", body: "{title}" },
    MOVIE_SERIES: {
      title: "¿Hoy ves algo?",
      body: "{title}",
    },
    PLACE: { title: "¿Hoy vas?", body: "{title}" },
    BOOK: { title: "¿Empiezas a leer?", body: "{title}" },
    MUSIC: { title: "¿Lo escuchas hoy?", body: "{title}" },
    PODCAST: { title: "¿Lo escuchas hoy?", body: "{title}" },
    EVENT: { title: "Tu evento es el {fecha}", body: "{title}" },
    OTHER: { title: "¿Hoy es el día?", body: "{title}" },
  };

  const template = templates[category || "OTHER"] || templates.OTHER;

  // Para listas, agregar el contador
  if (isList) {
    template.body = "{title}";
  }

  return template;
}

/**
 * Arma el payload de Web Push (sin cifrado, lo hace web-push).
 */
function buildPushPayload(
  item: Item,
  slotKey: string,
  messageParams: Record<string, number>,
  correlationId: string,
): Record<string, unknown> {
  const category = item.category as string | null;
  const isList = isCategoryList(category);
  const template = getMessageTemplate(category, isList);
  const title = item.title as string;

  let pushTitle = template.title;
  let pushBody = template.body;

  // Reemplazar placeholders
  if (category === "EVENT") {
    const eventDate = (item.details as Record<string, unknown>)?.eventDate || "";
    pushTitle = pushTitle.replace("{fecha}", String(eventDate));
  }

  // Para listas con pending
  if (isList && messageParams.remaining > 0) {
    pushBody = `${title} · Te faltan ${messageParams.remaining} de ${messageParams.total}`;
  } else {
    pushBody = pushBody.replace("{title}", title);
  }

  // Truncar title a 120 caracteres si es necesario
  if (pushTitle.length > 120) {
    pushTitle = pushTitle.substring(0, 117) + "...";
  }

  return {
    v: 1,
    type: "REMINDER",
    slotKey,
    videoId: item.videoId,
    title: pushTitle,
    body: pushBody,
    icon: "/icons/icon-192.png",
    url: `/items/${item.videoId}?slot=${slotKey}`,
    correlationId,
  };
}

/**
 * Guarda la notificación en DynamoDB (bandeja).
 */
async function saveNotification(notification: Notification): Promise<void> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: notification,
      }),
    );
  } catch (error) {
    console.error("Error saving notification:", error);
    throw error;
  }
}

/**
 * Envía Web Push a una suscripción.
 */
async function sendWebPushToSubscription(
  subscription: PushSubscription,
  payload: Record<string, unknown>,
  vapidPrivateKey: string,
): Promise<void> {
  try {
    const endpoint = subscription.endpoint as string;
    const keysObj = subscription.keys as Record<string, string>;

    webpush.setVapidDetails("mailto:nudgee@example.com", VAPID_PUBLIC_KEY, vapidPrivateKey);

    await webpush.sendNotification(
      {
        endpoint,
        keys: {
          p256dh: keysObj.p256dh || "",
          auth: keysObj.auth || "",
        },
      },
      JSON.stringify(payload),
    );
  } catch (error: unknown) {
    const err = error as any;

    // 410 Gone → suscripción expirada, eliminarla
    if (err.statusCode === 410) {
      console.log(`Push subscription expired: ${(subscription.endpoint as string).substring(0, 50)}`);
      // No borramos acá para evitar side effects; el cliente las limpia al iniciar
      return;
    }

    // 400 Bad Request → probablemente inválida
    if (err.statusCode === 400) {
      console.warn(`Invalid push subscription: ${err.message}`);
      return;
    }

    // Otros errores → log pero no falla el dispatcher
    console.error(`Error sending push notification: ${err.message}`);
  }
}

/**
 * Envía Web Push a todas las suscripciones.
 */
async function sendWebPushToAll(
  subscriptions: PushSubscription[],
  payload: Record<string, unknown>,
  vapidPrivateKey: string,
): Promise<void> {
  const promises = subscriptions.map((sub) =>
    sendWebPushToSubscription(sub, payload, vapidPrivateKey),
  );

  await Promise.allSettled(promises);
}

/**
 * Actualiza notifyCount e incrementa lastNotifiedAt del ítem.
 */
async function updateItemNotifyCount(userId: string, videoId: string): Promise<void> {
  try {
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
        UpdateExpression: "SET notifyCount = notifyCount + :inc, lastNotifiedAt = :now",
        ExpressionAttributeValues: {
          ":inc": 1,
          ":now": now,
        },
      }),
    );
  } catch (error) {
    console.error(`Error updating item notifyCount for ${videoId}:`, error);
    // No falla el dispatcher; es un update no crítico
  }
}

/**
 * Handler principal del Dispatcher.
 */
export const handler = async (event: Record<string, unknown>) => {
  const slotKey = event.slotKey as string;
  const userId = event.userId as string;
  const correlationId = (event.correlationId as string) || randomUUID();

  console.log(
    JSON.stringify({
      level: "info",
      correlationId,
      slotKey,
      userId,
      message: "Dispatcher starting",
    }),
  );

  if (!slotKey || !userId) {
    console.error("Missing slotKey or userId in event");
    return { statusCode: 400, body: "Missing slotKey or userId" };
  }

  try {
    // Paso 1: Obtener ítems PENDING para este slot
    const items = await queryPendingItems(slotKey, userId);

    console.log(
      JSON.stringify({
        level: "info",
        correlationId,
        slotKey,
        itemCount: items.length,
        message: "Found pending items",
      }),
    );

    if (items.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
    }

    // Paso 2: Obtener suscripciones push
    const subscriptions = await getPushSubscriptions(userId);

    // Paso 3: Obtener VAPID private key
    const vapidPrivateKey = await getVapidPrivateKey();

    // Paso 4: Para cada ítem
    for (const item of items) {
      // Armar y guardar notificación
      const notification = buildNotification(item, slotKey);
      await saveNotification(notification);

      // Si hay suscripciones, enviar push
      if (subscriptions.length > 0) {
        const isList = isCategoryList(item.category as string);
        const messageParams = calculateMessageParams(item, isList);
        const payload = buildPushPayload(item, slotKey, messageParams, correlationId);

        await sendWebPushToAll(subscriptions, payload, vapidPrivateKey);
      }

      // Actualizar notifyCount del ítem
      await updateItemNotifyCount(userId, item.videoId as string);
    }

    console.log(
      JSON.stringify({
        level: "info",
        correlationId,
        slotKey,
        processed: items.length,
        message: "Dispatcher completed successfully",
      }),
    );

    return { statusCode: 200, body: JSON.stringify({ processed: items.length }) };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        correlationId,
        slotKey,
        userId,
        message: "Dispatcher error",
        error: String(error),
      }),
    );

    return { statusCode: 500, body: JSON.stringify({ error: "Dispatcher failed" }) };
  }
};
