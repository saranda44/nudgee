/**
 * Tests del handler del dispatcher: idempotencia por franja (AP-13), reintento con el siguiente
 * candidato y deliveryStatus/limpieza de suscripciones. DynamoDB, SSM y web-push se mockean.
 */

import { describe, it, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { SSMClient } from "@aws-sdk/client-ssm";
import webpush from "web-push";
import { mockDdb, TEST_SUB, type CommandInput } from "../api/test-helpers.ts";

process.env.TABLE_NAME = "test-table";
process.env.AWS_REGION ??= "us-east-1";

type Handler = typeof import("./index.ts").handler;
let handler: Handler;

before(async () => {
  ({ handler } = await import("./index.ts"));
});

const NOW = new Date("2026-06-15T15:02:00Z");
const EVENT = { userId: TEST_SUB, scheduledTime: "2026-06-15T15:00:00Z", correlationId: "exec-1" };
const PROFILE = { PK: `USER#${TEST_SUB}`, SK: "PROFILE", timezone: "America/Mexico_City" };

function fullItem(videoId: string, extra: Record<string, unknown> = {}) {
  return { PK: `USER#${TEST_SUB}`, SK: `ITEM#${videoId}`, videoId, status: "PENDING", version: 4, title: `Receta ${videoId}`, category: "RECIPE", ...extra };
}

function canceled(codes: string[]) {
  const error = new Error("Transaction cancelled") as Error & { CancellationReasons?: unknown };
  error.name = "TransactionCanceledException";
  error.CancellationReasons = codes.map((Code) => ({ Code }));
  return error;
}

interface Table {
  candidates: Array<Record<string, unknown>>;
  subscriptions?: Array<Record<string, unknown>>;
  items: Record<string, Record<string, unknown>>;
  transact?: (input: CommandInput) => unknown;
}

function fakeTable(table: Table) {
  return mockDdb((input, name) => {
    if (name === "GetCommand") {
      if (input.Key.SK === "PROFILE") return { Item: PROFILE };
      return { Item: table.items[input.Key.SK.replace("ITEM#", "")] };
    }
    if (name === "QueryCommand") {
      return { Items: input.IndexName === "GSI1" ? table.candidates : (table.subscriptions ?? []) };
    }
    if (name === "TransactWriteCommand") return table.transact?.(input) ?? {};
    return {};
  });
}

const candidate = (videoId: string, savedAt: string) => ({ videoId, GSI1SK: `${savedAt}#${videoId}`, category: "RECIPE", notifyCount: 0 });

beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  mock.method(SSMClient.prototype, "send", async () => ({ Parameter: { Value: "private-key" } }));
  mock.method(webpush, "setVapidDetails", () => {});
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe("dispatcher handler", () => {
  it("si la franja ya está registrada (doble disparo) no reenvía ni toca más el ítem", async () => {
    const push = mock.method(webpush, "sendNotification", async () => ({}));
    const ddb = fakeTable({
      candidates: [candidate("aaaaaaaaaaa", "2026-01-01")],
      subscriptions: [{ PK: `USER#${TEST_SUB}`, SK: "SUB#1", endpoint: "https://fcm.googleapis.com/x", keys: {} }],
      items: { aaaaaaaaaaa: fullItem("aaaaaaaaaaa") },
      transact: () => {
        throw canceled(["ConditionalCheckFailed", "None"]);
      },
    });

    const out = await handler(EVENT);

    assert.equal(out.result, "ALREADY_SENT");
    assert.equal(push.mock.callCount(), 0);
    const writes = ddb.inputs.filter((i) => i.TransactItems || i.UpdateExpression);
    assert.equal(writes.length, 1, "solo el intento de transacción");
  });

  it("registra NOTIF con slotKey local y condición de unicidad junto con notifyCount + 1", async () => {
    let transactInput: CommandInput | undefined;
    fakeTable({
      candidates: [candidate("aaaaaaaaaaa", "2026-01-01")],
      items: { aaaaaaaaaaa: fullItem("aaaaaaaaaaa", { scheduledFor: "2026-06-15" }) },
      transact: (input) => {
        transactInput = input;
      },
    });

    const out = await handler(EVENT);

    assert.deepEqual(out, { result: "SENT", slotKey: "2026-06-15T09", videoId: "aaaaaaaaaaa", deliveryStatus: "IN_APP", targetCount: 0, successCount: 0 });
    const [put, update] = transactInput!.TransactItems;
    assert.equal(put.Put.Item.SK, "NOTIF#2026-06-15T09");
    assert.equal(put.Put.ConditionExpression, "attribute_not_exists(PK)");
    assert.equal(put.Put.Item.deliveryStatus, "IN_APP");
    assert.equal(update.Update.Key.SK, "ITEM#aaaaaaaaaaa");
    assert.match(update.Update.UpdateExpression, /notifyCount = if_not_exists\(notifyCount, :zero\) \+ :one/);
    assert.match(update.Update.UpdateExpression, /REMOVE scheduledFor/, "el reprogramado se consume");
    assert.equal(update.Update.ExpressionAttributeValues[":version"], 4);
  });

  it("si el primer candidato cambió de estado, registra el siguiente", async () => {
    const attempted: string[] = [];
    fakeTable({
      candidates: [candidate("bbbbbbbbbbb", "2026-02-01"), candidate("aaaaaaaaaaa", "2026-01-01")],
      items: { aaaaaaaaaaa: fullItem("aaaaaaaaaaa"), bbbbbbbbbbb: fullItem("bbbbbbbbbbb") },
      transact: (input) => {
        const videoId = input.TransactItems[0].Put.Item.videoId;
        attempted.push(videoId);
        if (videoId === "aaaaaaaaaaa") throw canceled(["None", "ConditionalCheckFailed"]);
      },
    });

    const out = await handler(EVENT);

    assert.deepEqual(attempted, ["aaaaaaaaaaa", "bbbbbbbbbbb"], "en orden de antigüedad");
    assert.equal(out.result === "SENT" && out.videoId, "bbbbbbbbbbb");
  });

  it("con suscripciones: PARTIAL si una falla y borra la que respondió 410", async () => {
    mock.method(webpush, "sendNotification", async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return {};
    });
    const ddb = fakeTable({
      candidates: [candidate("aaaaaaaaaaa", "2026-01-01")],
      subscriptions: [
        { PK: `USER#${TEST_SUB}`, SK: "SUB#ok", subscriptionId: "ok", endpoint: "https://fcm.googleapis.com/ok", keys: {} },
        { PK: `USER#${TEST_SUB}`, SK: "SUB#gone", subscriptionId: "gone", endpoint: "https://fcm.googleapis.com/gone", keys: {} },
      ],
      items: { aaaaaaaaaaa: fullItem("aaaaaaaaaaa") },
    });

    const out = await handler(EVENT);

    assert.equal(out.result === "SENT" && out.deliveryStatus, "PARTIAL");
    const deleted = ddb.inputs.filter((i) => i.Key?.SK?.startsWith("SUB#") && !i.UpdateExpression);
    assert.deepEqual(deleted.map((i) => i.Key.SK), ["SUB#gone"]);
    const finalUpdate = ddb.inputs.find((i) => i.Key?.SK === "NOTIF#2026-06-15T09");
    assert.deepEqual(finalUpdate?.ExpressionAttributeValues, { ":status": "PARTIAL", ":ok": 1 });
  });

  it("pasa a DORMANT los ítems con 3 recordatorios ignorados", async () => {
    const ddb = fakeTable({
      candidates: [{ ...candidate("ccccccccccc", "2026-01-01"), notifyCount: 3 }],
      items: {},
    });

    const out = await handler(EVENT);

    assert.equal(out.result, "NO_CANDIDATES");
    const dormant = ddb.inputs.find((i) => i.ExpressionAttributeValues?.[":dormant"] === "DORMANT");
    assert.equal(dormant?.Key.SK, "ITEM#ccccccccccc");
    assert.match(dormant!.UpdateExpression, /REMOVE GSI1PK, GSI1SK/);
  });
});
