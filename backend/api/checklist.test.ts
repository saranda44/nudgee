/**
 * E-18: la primera marca de un ítem sin mapa `checklist` lo crea (antes DynamoDB respondía
 * "document path ... invalid" y la API daba 500); con mapa, merge por llave (D-03).
 */

import { describe, it, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { conditionalFailure, makeEvent, mockDdb, parseBody, TEST_CORRELATION_ID, TEST_VIDEO_ID } from "./test-helpers.ts";

process.env.TABLE_NAME = "test-table";
process.env.AWS_REGION ??= "us-east-1";

type Dispatch = (event: ReturnType<typeof makeEvent>, correlationId: string) => Promise<APIGatewayProxyStructuredResultV2>;
let dispatch: Dispatch;

before(async () => {
  const { createRouter } = await import("./router.ts");
  const { checklistRoutes } = await import("./checklist.ts");
  dispatch = createRouter(checklistRoutes);
});

afterEach(() => mock.restoreAll());

const ITEM = {
  status: "PENDING",
  category: "ROUTINE",
  details: { exercises: [{ id: "i1", text: "Sentadillas" }, { id: "i2", text: "Plancha" }] },
};
const mark = (body: unknown) =>
  dispatch(
    makeEvent({ method: "PATCH", path: `/v1/items/${TEST_VIDEO_ID}/checklist`, body: JSON.stringify(body) }),
    TEST_CORRELATION_ID,
  );

describe("E-18 PATCH /checklist", () => {
  it("ítem sin mapa checklist → crea el mapa con attribute_not_exists (sin 500)", async () => {
    const ddb = mockDdb((_, name) => (name === "GetCommand" ? { Item: ITEM } : {}));
    const res = await mark({ i1: true });

    assert.equal(res.statusCode, 200, `body: ${res.body}`);
    assert.deepEqual(parseBody(res).checklist, { i1: true });
    const update = ddb.inputs[1];
    assert.equal(update.UpdateExpression, "SET #checklist = :checklist");
    assert.match(update.ConditionExpression, /attribute_not_exists\(#checklist\)/);
  });

  it("con mapa → solo actualiza las llaves enviadas", async () => {
    const ddb = mockDdb((_, name) => (name === "GetCommand" ? { Item: { ...ITEM, checklist: { i1: true } } } : {}));
    const res = await mark({ i2: true });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseBody(res), { videoId: TEST_VIDEO_ID, checklist: { i1: true, i2: true }, suggestDone: true });
    assert.equal(ddb.inputs[1].UpdateExpression, "SET #checklist.#id0 = :val0");
  });

  it("otro dispositivo creó el mapa entre la lectura y la escritura → reintenta con merge", async () => {
    let updates = 0;
    const ddb = mockDdb((_, name) => {
      if (name === "GetCommand") return { Item: ITEM };
      if (++updates === 1) throw conditionalFailure();
      return {};
    });
    const res = await mark({ i1: true });
    assert.equal(res.statusCode, 200);
    assert.equal(ddb.inputs[2].UpdateExpression, "SET #checklist.#id0 = :val0");
  });

  it("falla las dos veces (el ítem cambió de estado) → 409", async () => {
    mockDdb((_, name) => {
      if (name === "GetCommand") return { Item: ITEM };
      throw conditionalFailure();
    });
    const res = await mark({ i1: true });
    assert.equal(res.statusCode, 409);
  });
});
