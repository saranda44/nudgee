"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_sqs_1 = require("@aws-sdk/client-sqs");
const sqs = new client_sqs_1.SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL;
const handler = async (event) => {
    console.log("Request recibido:", event.body);
    // TODO para Emilio:
    // 1. Validar URL del body
    // 2. TransactWriteItems en DynamoDB (guardado + cuotas)
    // 3. Mandar mensaje a SQS FIFO
    return {
        statusCode: 202,
        body: JSON.stringify({ message: "Video encolado para análisis" })
    };
};
exports.handler = handler;
