import { PostAuthenticationTriggerEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: PostAuthenticationTriggerEvent) => {
  console.log("Evento Post-Auth recibido para usuario:", event.userName);

  const userId = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email;
  const now = new Date().toISOString();

  try {
    // Usamos UpdateCommand para hacer un "Upsert" (crear si no existe, actualizar si existe)
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: 'PROFILE'
      },
      UpdateExpression: "SET email = :email, lastLoginAt = :now, createdAt = if_not_exists(createdAt, :now), tz = if_not_exists(tz, :defaultTz)",
      ExpressionAttributeValues: {
        ":email": email,
        ":now": now,
        ":defaultTz": "America/Mexico_City" // Zona horaria por defecto
      }
    }));
    
    console.log("Perfil actualizado exitosamente en DynamoDB");
  } catch (error) {
    console.error("Error al guardar el perfil en DynamoDB:", error);
    // No lanzamos el error para no bloquear el login del usuario si falla la BD
  }

  // Cognito exige que devolvamos el mismo evento que recibimos
  return event;
};
