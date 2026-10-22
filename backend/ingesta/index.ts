import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL;

export const handler: APIGatewayProxyHandlerV2 = async (event: APIGatewayProxyEventV2) => {
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