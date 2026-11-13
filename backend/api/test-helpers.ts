/**
 * Utilidades compartidas por los tests de la Lambda API (node:test).
 * DynamoDB se mockea a nivel del prototipo de DynamoDBDocumentClient: nunca se llama a AWS.
 */

import { mock } from "node:test";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

export const TEST_SUB = "user-sub-123";
export const TEST_VIDEO_ID = "dQw4w9WgXcQ";
export const TEST_CORRELATION_ID = "test-correlation-id";

interface EventOptions {
  method: string;
  path: string;
  /** `null` simula una ruta sin authorizer JWT. */
  sub?: string | null;
  headers?: Record<string, string>;
  body?: string;
}

/** Evento HTTP API v2 mínimo, con el `sub` en los claims del authorizer JWT. */
export function makeEvent({ method, path, sub = TEST_SUB, headers = {}, body }: EventOptions): APIGatewayProxyEventV2 {
  const authorizer = sub === null ? undefined : { jwt: { claims: { sub }, scopes: [] } };
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers,
    body,
    isBase64Encoded: false,
    requestContext: {
      accountId: "000000000000",
      apiId: "test",
      domainName: "test.local",
      domainPrefix: "test",
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "node-test" },
      requestId: "req-1",
      routeKey: "$default",
      stage: "$default",
      time: "",
      timeEpoch: 0,
      ...(authorizer ? { authorizer } : {}),
    },
  } as APIGatewayProxyEventV2;
}

/** Input de un comando del SDK (UpdateCommand, DeleteCommand, …) tal como lo recibió `send`. */
export type CommandInput = Record<string, any>;

/**
 * Reemplaza `send` del DocumentClient. `impl` recibe el input del comando y devuelve
 * la respuesta (o lanza). Restaurar con `mock.restoreAll()` en `afterEach`.
 */
export function mockDdb(impl: (input: CommandInput, commandName: string) => unknown) {
  const sendMock = mock.method(DynamoDBDocumentClient.prototype, "send", async (command: any) =>
    impl(command.input as CommandInput, command.constructor.name),
  );
  return {
    get callCount() {
      return sendMock.mock.callCount();
    },
    /** Inputs de cada llamada, en orden. */
    get inputs(): CommandInput[] {
      return sendMock.mock.calls.map((call) => (call.arguments[0] as any).input as CommandInput);
    },
  };
}

/**
 * Error equivalente al que lanza el SDK cuando falla una ConditionExpression. Igual que en
 * AWS real, el `Item` viene en formato AttributeValue (el DocumentClient no lo convierte).
 */
export function conditionalFailure(oldItem?: Record<string, unknown>): Error {
  const error = new Error("The conditional request failed") as Error & { Item?: Record<string, unknown> };
  error.name = "ConditionalCheckFailedException";
  if (oldItem) error.Item = marshall(oldItem, { removeUndefinedValues: true });
  return error;
}

export function parseBody(res: APIGatewayProxyStructuredResultV2): any {
  return res.body ? JSON.parse(res.body) : undefined;
}
