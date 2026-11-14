/**
 * Tests de E-20 (registrar suscripción push): upsert en una escritura, 201 si es nueva y 200 si
 * el mismo endpoint ya existía, lista blanca de hosts (API-13).
 */

import { describe, it, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { makeEvent, mockDdb, parseBody, TEST_CORRELATION_ID, TEST_SUB } from "./test-helpers.ts";

process.env.TABLE_NAME = "test-table";
process.env.AWS_REGION ??= "us-east-1";

type Dispatch = (event: ReturnType<typeof makeEvent>, correlationId: string) => Promise<APIGatewayProxyStructuredResultV2>;
let dispatch: Dispatch;

before(async () => {
  const { createRouter } = await import("./router.ts");
  const { pushSubscriptionRoutes } = await import("./push-subscriptions.ts");
  dispatch = createRouter(pushSubscriptionRoutes);
});

afterEach(() => mock.restoreAll());

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc:APA91b";
const SUB_ID = createHash("sha256").update(ENDPOINT).digest("hex");
const subscribe = (body: unknown) =>
  dispatch(makeEvent({ method: "POST", path: "/v1/push-subscriptions", body: JSON.stringify(body) }), TEST_CORRELATION_ID);
const validBody = { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: "BNc", auth: "tBH" }, platform: "Chrome" };

describe("E-20 POST /v1/push-subscriptions", () => {
  it("suscripción nueva → 201, una escritura con createdAt if_not_exists", async () => {
    const ddb = mockDdb(() => ({}));
    const res = await subscribe(validBody);

    assert.equal(res.statusCode, 201, `body: ${res.body}`);
    assert.deepEqual(parseBody(res), { subscriptionId: SUB_ID });
    assert.equal(ddb.callCount, 1);
    const input = ddb.inputs[0];
    assert.deepEqual(input.Key, { PK: `USER#${TEST_SUB}`, SK: `SUB#${SUB_ID}` });
    assert.equal(input.ReturnValues, "ALL_OLD");
    assert.match(input.UpdateExpression, /#createdAt = if_not_exists\(#createdAt, :now\)/);
  });

  it("mismo endpoint ya registrado → 200", async () => {
    mockDdb(() => ({ Attributes: { subscriptionId: SUB_ID, createdAt: "2026-01-01T00:00:00.000Z" } }));
    const res = await subscribe(validBody);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseBody(res), { subscriptionId: SUB_ID });
  });

  it("guarda solo p256dh y auth de keys", async () => {
    const ddb = mockDdb(() => ({}));
    await subscribe({ ...validBody, keys: { ...validBody.keys, extra: "x" } });
    assert.deepEqual(ddb.inputs[0].ExpressionAttributeValues[":keys"], { p256dh: "BNc", auth: "tBH" });
  });

  it("host fuera de la lista blanca → 400 UNSUPPORTED_PUSH_SERVICE sin escribir", async () => {
    const ddb = mockDdb(() => ({}));
    const res = await subscribe({ ...validBody, endpoint: "https://evil.example.com/push" });
    assert.equal(res.statusCode, 400);
    assert.equal(parseBody(res).errors[0].code, "UNSUPPORTED_PUSH_SERVICE");
    assert.equal(ddb.callCount, 0);
  });
});
