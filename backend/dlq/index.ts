import { SQSEvent, SQSHandler } from 'aws-lambda';

export const handler: SQSHandler = async (event: SQSEvent) => {
  console.log("Procesando mensajes de la DLQ...", event.Records.length);

  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    console.log("Mensaje muerto para videoId:", body.videoId);

    // TODO:
    // 1. Leer userId, videoId y correlationId del mensaje
    // 2. UpdateItem condicional: status = PROCESSING -> NEEDS_INPUT,
    //    analysisError = RETRIES_EXHAUSTED, statusUpdatedAt
    // 3. Si la condición falla (el ítem ya no está en PROCESSING), ignorar
    //    sin reintentar: alguien más ya lo resolvió
  }
};
