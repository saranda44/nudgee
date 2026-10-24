import { ChangeMessageVisibilityCommand, SQSClient } from "@aws-sdk/client-sqs";

const sqsClient = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL!;

/** backoff de reintentos ante 429/5xx/timeout de Gemini. */
const BACKOFF_SECONDS = [15, 30, 60, 120];

/** Debe coincidir con `maxReceiveCount` del redrive policy en infra/modules/sqs. */
export const MAX_RECEIVE_COUNT = 5;

export function backoffSecondsForAttempt(attempt: number): number {
  const index = Math.min(Math.max(attempt - 1, 0), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[index];
}

export function isLastAttempt(receiveCount: number): boolean {
  return receiveCount >= MAX_RECEIVE_COUNT;
}

/** Retrasa la próxima entrega de este mensaje según el intento actual. */
export async function scheduleRetry(receiptHandle: string, attempt: number): Promise<void> {
  await sqsClient.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: backoffSecondsForAttempt(attempt),
    }),
  );
}
