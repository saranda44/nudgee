"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const handler = async (event) => {
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
exports.handler = handler;
