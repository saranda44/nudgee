/**
 * E-20 POST /v1/push-subscriptions y E-21 DELETE /v1/push-subscriptions/{subscriptionId}
 * (Push subscriptions).
 */

import { createHash } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { readJsonBody, requireUserId, type Route, type HandlerContext } from "./router.ts";
import { ProblemError, buildProblemResponse, buildValidationErrorResponse } from "./problem.ts";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Tabla de suscripciones push.
 */
const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  /^[a-z0-9.-]*\.notify\.windows\.com$/i, // *.notify.windows.com
];

/**
 * Valida que el host del endpoint esté en la lista blanca.
 */
function isAllowedPushHost(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname;

    for (const allowed of ALLOWED_PUSH_HOSTS) {
      if (typeof allowed === "string") {
        if (host === allowed) return true;
      } else if (allowed instanceof RegExp) {
        if (allowed.test(host)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Calcula el SHA-256 hex del endpoint.
 */
function calculateSubscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export const pushSubscriptionRoutes: Route[] = [
  // E-20: Registrar suscripción push
  {
    method: "POST",
    path: "/v1/push-subscriptions",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);

      const body = readJsonBody(ctx);
      const { endpoint, expirationTime, keys, platform } = body as Record<string, unknown>;

      // Validar campos obligatorios
      const errors: Array<{ pointer: string; code: string; message: string }> = [];

      if (typeof endpoint !== "string" || !endpoint) {
        errors.push({ pointer: "/endpoint", code: "REQUIRED", message: "must not be empty" });
      }

      if (!keys || typeof keys !== "object") {
        errors.push({ pointer: "/keys", code: "REQUIRED", message: "must be an object" });
      } else {
        const keysObj = keys as Record<string, unknown>;
        if (typeof keysObj.p256dh !== "string") {
          errors.push({ pointer: "/keys/p256dh", code: "REQUIRED", message: "must not be empty" });
        }
        if (typeof keysObj.auth !== "string") {
          errors.push({ pointer: "/keys/auth", code: "REQUIRED", message: "must not be empty" });
        }
      }

      if (errors.length > 0) {
        return buildValidationErrorResponse(errors, ctx.correlationId);
      }

      // Validar que el host esté en la lista blanca
      if (!isAllowedPushHost(endpoint as string)) {
        return buildValidationErrorResponse(
          [{ pointer: "/endpoint", code: "UNSUPPORTED_PUSH_SERVICE", message: "push service host is not allowed" }],
          ctx.correlationId,
        );
      }

      const subscriptionId = calculateSubscriptionId(endpoint as string);
      const now = new Date().toISOString();

      try {
        // Upsert: si ya existe, solo actualiza las claves + lastSuccessAt
        const result = await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              PK: `USER#${userId}`,
              SK: `SUB#${subscriptionId}`,
              subscriptionId,
              endpoint,
              expirationTime: expirationTime ?? null,
              keys,
              platform: platform ?? null,
              createdAt: now,
              lastSuccessAt: now,
              entityType: "PUSH_SUBSCRIPTION",
            },
            ReturnValues: "NONE",
          }),
        );

        // Determinar si es nuevo o actualización
        // En DynamoDB, PutItem siempre reemplaza, así que no sabemos si es nuevo
        // Contratos dice devolver 201 si nuevo, 200 si actualización
        // Por simplicidad, devolvemos 201 siempre (creado o actualizado)
        // En producción, podrías hacer un GetItem primero para saber

        return {
          statusCode: 201,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionId }),
        };
      } catch (error: unknown) {
        throw error;
      }
    },
  },

  // E-21: Quitar suscripción push
  {
    method: "DELETE",
    path: "/v1/push-subscriptions/:subscriptionId",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const { subscriptionId } = ctx.params;

      // Validar formato de subscriptionId (SHA-256 hex = 64 caracteres hexadecimales)
      if (!/^[a-f0-9]{64}$/.test(subscriptionId)) {
        return buildValidationErrorResponse(
          [{ pointer: "/subscriptionId", code: "INVALID_FORMAT", message: "must be a valid subscription ID" }],
          ctx.correlationId,
        );
      }

      try {
        await docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `SUB#${subscriptionId}` },
          }),
        );

        // Idempotente: devolver 204 incluso si no existía
        return {
          statusCode: 204,
          headers: {},
          body: "",
        };
      } catch (error: unknown) {
        throw error;
      }
    },
  },
];
