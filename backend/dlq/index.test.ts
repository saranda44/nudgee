/**
 * Tests de la Lambda DLQ: NEEDS_INPUT + RETRIES_EXHAUSTED y la métrica EMF
 * `AnalysisDeadLettered` por mensaje (NFR-10). DynamoDB se mockea.
 */

import { describe, it, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { mockDdb, TEST_SUB, TEST_VIDEO_ID } from "../api/test-helpers.ts";

process.env.TABLE_NAME = "test-table";
process.env.AWS_REGION ??= "us-east-1";

type Handler = typeof import("./index.ts").handler;
let handler: Handler;

before(async () => {
  ({ handler } = await import("./index.ts"));
});

afterEach(() => {
  mock.restoreAll();
});

function sqsEvent(...bodies: string[]): SQSEvent {
  return { Records: bodies.map((body, i) => ({ messageId: `msg-${i}`, body }) as SQSRecord) };
}

/** Captura los `console.log` y devuelve las líneas EMF con la métrica pedida. */
function captureMetric(name: string) {
  const logs = mock.method(console, "log", () => {});
  return () =>
    logs.mock.calls
      .map((c) => JSON.parse(String(c.arguments[0])))
      .filter((line) => line._aws?.CloudWatchMetrics?.[0]?.Metrics?.some((m: { Name: string }) => m.Name === name));
}

describe("dlq handler", () => {
  it("marca el ítem NEEDS_INPUT + RETRIES_EXHAUSTED y emite AnalysisDeadLettered sin dimensiones", async () => {
    const metrics = captureMetric("AnalysisDeadLettered");
    const ddb = mockDdb(() => ({}));

    await handler(sqsEvent(JSON.stringify({ userId: TEST_SUB, videoId: TEST_VIDEO_ID, correlationId: "c-1" })));

    assert.equal(ddb.inputs.length, 1);
    assert.deepEqual(ddb.inputs[0].Key, { PK: `USER#${TEST_SUB}`, SK: `ITEM#${TEST_VIDEO_ID}` });
    assert.equal(ddb.inputs[0].ExpressionAttributeValues[":status"], "NEEDS_INPUT");
    assert.equal(ddb.inputs[0].ExpressionAttributeValues[":error"], "RETRIES_EXHAUSTED");

    const lines = metrics();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].AnalysisDeadLettered, 1);
    assert.equal(lines[0]._aws.CloudWatchMetrics[0].Namespace, "Nudgee");
    assert.deepEqual(lines[0]._aws.CloudWatchMetrics[0].Dimensions, [[]]);
  });

  it("cuenta también los mensajes malformados, sin escribir en DynamoDB", async () => {
    const metrics = captureMetric("AnalysisDeadLettered");
    const ddb = mockDdb(() => ({}));

    await handler(sqsEvent("no es json", JSON.stringify({ videoId: TEST_VIDEO_ID })));

    assert.equal(ddb.inputs.length, 0);
    assert.equal(metrics().length, 2);
  });

  it("si DynamoDB falla no lanza y la métrica ya se emitió", async () => {
    const metrics = captureMetric("AnalysisDeadLettered");
    mockDdb(() => {
      throw new Error("boom");
    });

    await handler(sqsEvent(JSON.stringify({ userId: TEST_SUB, videoId: TEST_VIDEO_ID })));

    assert.equal(metrics().length, 1);
  });
});
