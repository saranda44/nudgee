/**
 * Encolado en SQS FIFO para el Worker IA.
 */

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqsClient = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL!;

export interface AnalysisMessage {
  userId: string;
  videoId: string;
  correlationId: string;
  savedAt: string;
}

/**
 * MessageGroupId = videoId agrupa reintentos del mismo video (y permite que la
 * caché global evite análisis repetidos; MessageDeduplicationId =
 * userId#videoId es la deduplicación nativa de SQS FIFO (5 min) para reintentos
 * de red muy cercanos.
 */
export async function sendAnalysisMessage(message: AnalysisMessage): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageGroupId: message.videoId,
      MessageDeduplicationId: `${message.userId}#${message.videoId}`,
    }),
  );
}
