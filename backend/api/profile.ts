/**
 * E-03 GET /v1/me y E-04 PATCH /v1/me (Sistema y perfil).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { requireUserId, type Route, type HandlerContext } from "./router.ts";
import { ProblemError, buildProblemResponse, buildValidationErrorResponse } from "./problem.ts";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

// Locales soportados (hoy solo es-MX, pero extensible)
const SUPPORTED_LOCALES = ["es-MX"];

interface UserProfile {
  userId: string;
  email: string;
  name: string;
  timezone: string;
  locale: string;
  scheduleState: "NONE" | "ACTIVE";
  subscriptionCount: number;
  createdAt: string;
}

async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: "PROFILE" },
    }),
  );

  if (!result.Item) return null;

  const item = result.Item as Record<string, unknown>;

  // Contar suscripciones push (Query con Select=COUNT)
  const subResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sk": "SUB#" },
      Select: "COUNT",
    }),
  );

  const scheduleState = item.scheduleState as string | undefined;
  return {
    userId: item.userId as string,
    email: item.email as string,
    name: item.name as string,
    timezone: item.timezone as string,
    locale: item.locale as string,
    scheduleState: (scheduleState === "ACTIVE" ? "ACTIVE" : "NONE") as "ACTIVE" | "NONE",
    subscriptionCount: subResult.Count ?? 0,
    createdAt: item.createdAt as string,
  };
}

function validateTimezone(tz: string): boolean {
  if (typeof Intl.supportedValuesOf !== "function") {
    return /^[A-Za-z_]+\/[A-Za-z_]+$/.test(tz);
  }
  const supported = Intl.supportedValuesOf("timeZone") as string[];
  return supported.includes(tz);
}

function validateLocale(locale: string): boolean {
  return SUPPORTED_LOCALES.includes(locale);
}

export const profileRoutes: Route[] = [
  // E-03: Ver perfil
  {
    method: "GET",
    path: "/v1/me",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);
      const profile = await getUserProfile(userId);

      if (!profile) {
        return buildProblemResponse(
          new ProblemError({
            status: 404,
            code: "PROFILE_NOT_FOUND",
            title: "Profile not found",
          }),
          ctx.correlationId,
        );
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      };
    },
  },

  // E-04: Actualizar zona horaria / locale
  {
    method: "PATCH",
    path: "/v1/me",
    auth: true,
    handler: async (ctx: HandlerContext) => {
      const userId = requireUserId(ctx);

      const body = ctx.event.body ? JSON.parse(ctx.event.body) : {};
      const { timezone, locale } = body as { timezone?: unknown; locale?: unknown };

      const errors: Array<{ pointer: string; code: string; message: string }> = [];

      // Validación
      if (timezone !== undefined && typeof timezone !== "string") {
        errors.push({ pointer: "/timezone", code: "INVALID_TYPE", message: "must be a string" });
      } else if (timezone && !validateTimezone(timezone)) {
        errors.push({ pointer: "/timezone", code: "INVALID_TIMEZONE", message: "must be a valid IANA time zone" });
      }

      if (locale !== undefined && typeof locale !== "string") {
        errors.push({ pointer: "/locale", code: "INVALID_TYPE", message: "must be a string" });
      } else if (locale && !validateLocale(locale)) {
        errors.push({ pointer: "/locale", code: "INVALID_LOCALE", message: "must be one of es-MX" });
      }

      if (errors.length > 0) {
        return buildValidationErrorResponse(errors, ctx.correlationId);
      }

      // Si no hay nada que actualizar, devuelve el perfil actual
      if (!timezone && !locale) {
        const profile = await getUserProfile(userId);
        if (!profile) {
          return buildProblemResponse(
            new ProblemError({
              status: 404,
              code: "PROFILE_NOT_FOUND",
              title: "Profile not found",
            }),
            ctx.correlationId,
          );
        }
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profile),
        };
      }

      // TODO (Fase 4): Si scheduleState = NONE, ejecutar CreateSchedule en EventBridge Scheduler.
      // Por ahora, solo actualizamos la zona. Cuando el Despachador esté listo, agregar:
      //   if (currentProfile.scheduleState === "NONE") {
      //     await createSchedule(userId, timezone || currentProfile.timezone);
      //     scheduleState = "ACTIVE";
      //   }

      const updates: string[] = [];
      const values: Record<string, unknown> = {};

      if (timezone) {
        updates.push("timezone = :tz");
        values[":tz"] = timezone;
      }
      if (locale) {
        updates.push("locale = :loc");
        values[":loc"] = locale;
      }

      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: "PROFILE" },
          UpdateExpression: `SET ${updates.join(", ")}`,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );

      const item = result.Attributes as Record<string, unknown>;
      const itemScheduleState = item.scheduleState as string | undefined;
      const profile: UserProfile = {
        userId: item.userId as string,
        email: item.email as string,
        name: item.name as string,
        timezone: item.timezone as string,
        locale: item.locale as string,
        scheduleState: (itemScheduleState === "ACTIVE" ? "ACTIVE" : "NONE") as "ACTIVE" | "NONE",
        subscriptionCount: 0,
        createdAt: item.createdAt as string,
      };

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      };
    },
  },
];
