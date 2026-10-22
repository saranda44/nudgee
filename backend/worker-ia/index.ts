import { SQSEvent, SQSHandler } from 'aws-lambda';

export const handler: SQSHandler = async (event: SQSEvent) => {
  console.log("Iniciando procesamiento de lote SQS...", event.Records.length);
  
  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    console.log("Procesando videoId:", body.videoId);
    
    // TODO para Sara:
    // 1. Consultar caché global en DynamoDB
    // 2. Invocar a Gemini API si no hay caché
    // 3. Escribir resultado en tabla base y caché
  }
};