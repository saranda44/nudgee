import { SQSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: SQSEvent) => {
  console.log(`Procesando ${event.Records.length} mensajes en DLQ`);

  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    const { videoId, userId } = body;

    if (!videoId || !userId) {
      console.error("Mensaje malformado en DLQ:", body);
      continue;
    }

    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
        UpdateExpression: "SET #st = :status, analysisError = :error, statusUpdatedAt = :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":status": "NEEDS_INPUT",
          ":error": "RETRIES_EXHAUSTED",
          ":now": new Date().toISOString()
        }
      }));
      console.log(`Ítem ${videoId} marcado como NEEDS_INPUT`);
    } catch (error) {
      console.error(`Error actualizando ítem ${videoId}:`, error);
    }
  }
};
