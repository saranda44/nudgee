/**
 * Trigger de Cognito (AP-01, API-09): upsert idempotente del PROFILE.
 * Se conecta como Post Authentication (cada login) y Post Confirmation (registro en el
 * Hosted UI, donde Cognito inicia sesión sin disparar Post Authentication).
 */

import type { PostAuthenticationTriggerEvent, PostConfirmationTriggerEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

// Defaults del perfil (Modelo de datos §3.1). El cliente actualiza timezone con E-04.
const DEFAULT_TIMEZONE = "America/Mexico_City";
const DEFAULT_LOCALE = "es-MX";

export const handler = async (event: PostAuthenticationTriggerEvent | PostConfirmationTriggerEvent) => {
  const attributes = event.request.userAttributes;
  const userId = attributes.sub;
  const now = new Date().toISOString();

  try {
    // Upsert: email/name/lastLoginAt se refrescan; los demás solo se escriben la primera vez.
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: "PROFILE" },
        // Alias en todos los atributos: `name` y `timezone` son palabras reservadas de DynamoDB.
        UpdateExpression:
          "SET #userId = :userId, #email = :email, #name = :name, #lastLoginAt = :now, " +
          "#createdAt = if_not_exists(#createdAt, :now), #timezone = if_not_exists(#timezone, :tz), " +
          "#locale = if_not_exists(#locale, :locale), #scheduleState = if_not_exists(#scheduleState, :none), " +
          "#version = if_not_exists(#version, :one)",
        ExpressionAttributeNames: {
          "#userId": "userId",
          "#email": "email",
          "#name": "name",
          "#lastLoginAt": "lastLoginAt",
          "#createdAt": "createdAt",
          "#timezone": "timezone",
          "#locale": "locale",
          "#scheduleState": "scheduleState",
          "#version": "version",
        },
        ExpressionAttributeValues: {
          ":userId": userId,
          ":email": attributes.email,
          ":name": attributes.name ?? attributes.given_name ?? "",
          ":now": now,
          ":tz": DEFAULT_TIMEZONE,
          ":locale": DEFAULT_LOCALE,
          ":none": "NONE",
          ":one": 1,
        },
      }),
    );
    console.log(JSON.stringify({ level: "info", trigger: event.triggerSource, message: "Perfil actualizado" }));
  } catch (error) {
    // No se relanza para no bloquear el login si falla DynamoDB (E-02 responderá 404).
    console.error(
      JSON.stringify({ level: "error", trigger: event.triggerSource, message: "Error al guardar el perfil", error: String(error) }),
    );
  }

  // Cognito exige devolver el mismo evento
  return event;
};
