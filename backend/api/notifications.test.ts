/**
 * Tests de E-19 (abrir un recordatorio): la apertura reinicia notifyCount del ÍTEM (AP-14, D-04),
 * es idempotente y responde 404 si la franja no existe.
 */

import { describe, it, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { makeEvent, mockDdb, parseBody, TEST_CORRELATION_ID, TEST_SUB, TEST_VIDEO_ID, type CommandInput } from "./test-helpers.ts";

process.env.TABLE_NAME = "test-table";
process.env.AWS_REGION ??= "us-east-1";

type Dispatch = (event: ReturnType<typeof makeEvent>, correlationId: string) => Promise<APIGatewayProxyStructuredResultV2>;
let dispatch: Dispatch;

before(async () => {
  const { createRouter } = await import("./router.ts");
  const { notificationRoutes } = await import("./notifications.ts");
  dispatch = createRouter(notificationRoutes);
});

afterEach(() => mock.restoreAll());

const SLOT = "2026-06-15T09";
const open = () => dispatch(makeEvent({ method: "POST", path: `/v1/notifications/${SLOT}/open` }), TEST_CORRELATION_ID);
const notif = (extra: Record<string, unknown> = {}) => ({
  PK: `USER#${TEST_SUB}`,
  SK: `NOTIF#${SLOT}`,
  videoId: TEST_VIDEO_ID,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  ...extra,
});

function canceled(codes: string[]) {
  return Object.assign(new Error("Transaction cancelled"), {
    name: "TransactionCanceledException",
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

describe("E-19 POST /v1/notifications/{slotKey}/open", () => {
  it("escribe openedAt y reinicia notifyCount del ítem en una transacción", async () => {
    let transact: CommandInput | undefined;
    mockDdb((input, name) => {
      if (name === "GetCommand") return { Item: notif() };
      if (name === "TransactWriteCommand") transact = input;
      return {};
    });

    const res = await open();

    assert.equal(res.statusCode, 204);
    const [notifUpdate, itemUpdate] = transact!.TransactItems;
    assert.equal(notifUpdate.Update.Key.SK, `NOTIF#${SLOT}`);
    assert.equal(itemUpdate.Update.Key.SK, `ITEM#${TEST_VIDEO_ID}`);
    assert.equal(itemUpdate.Update.UpdateExpression, "SET notifyCount = :zero");
  });

  it("si el ítem ya no está en PENDING solo registra openedAt", async () => {
    const ddb = mockDdb((_input, name) => {
      if (name === "GetCommand") return { Item: notif() };
      if (name === "TransactWriteCommand") throw canceled(["None", "ConditionalCheckFailed"]);
      return {};
    });

    const res = await open();

    assert.equal(res.statusCode, 204);
    const last = ddb.inputs.at(-1)!;
    assert.equal(last.Key.SK, `NOTIF#${SLOT}`);
    assert.equal(last.UpdateExpression, "SET openedAt = :now");
  });

  it("una segunda apertura no vuelve a reiniciar notifyCount", async () => {
    const ddb = mockDdb(() => ({ Item: notif({ openedAt: "2026-06-15T15:10:00Z" }) }));

    const res = await open();

    assert.equal(res.statusCode, 204);
    assert.equal(ddb.callCount, 1, "solo el GetItem");
  });

  it("404 si la franja no existe o ya venció", async () => {
    mockDdb(() => ({ Item: notif({ expiresAt: 1 }) }));
    const res = await open();
    assert.equal(res.statusCode, 404);
    assert.equal(parseBody(res).code, "NOTIFICATION_NOT_FOUND");
  });
});
