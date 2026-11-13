/**
 * Tests de las transiciones de estado E-10…E-17 (api/transitions.ts) contra RF §4.3–4.4.
 *
 * DynamoDB se reemplaza por una "tabla falsa" de un ítem que evalúa la ConditionExpression
 * que el handler envía: así la matriz acción × estado sale del código real, no de suposiciones.
 * Los tests marcados `todo` describen el contrato correcto y hoy fallan por bugs conocidos.
 */

import { describe, it, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  conditionalFailure,
  makeEvent,
  mockDdb,
  parseBody,
  TEST_CORRELATION_ID,
  TEST_SUB,
  TEST_VIDEO_ID,
  type CommandInput,
} from "./test-helpers.ts";

// transitions.ts lee TABLE_NAME al importarse: configurar antes del import dinámico.
process.env.TABLE_NAME = "test-table";
process.env.AWS_REGION ??= "us-east-1";

type Dispatch = (event: ReturnType<typeof makeEvent>, correlationId: string) => Promise<APIGatewayProxyStructuredResultV2>;
let dispatch: Dispatch;

before(async () => {
  const { createRouter } = await import("./router.ts");
  const { transitionRoutes } = await import("./transitions.ts");
  dispatch = createRouter(transitionRoutes);
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  delete process.env.SNOOZE_OPTIONS;
  delete process.env.SNOOZE_UNIT;
  delete process.env.DISCARD_RETENTION_DAYS;
});

const ALL_STATES = ["PROCESSING", "NEEDS_INPUT", "PENDING", "DORMANT", "DONE", "DISCARDED"] as const;
type Status = (typeof ALL_STATES)[number];

// "Hoy" fijo para E-12/E-13/E-14: 15-jun-2026 12:00 en America/Mexico_City.
const NOW = new Date("2026-06-15T18:00:00.000Z");

interface Action {
  id: string;
  action: string;
  method: string;
  suffix: string;
  /** RF §4.4: estados desde los que la acción está disponible. */
  allowed: Status[];
  body?: unknown;
  okStatus: number;
}

const ACTIONS: Action[] = [
  { id: "E-10", action: "done", method: "POST", suffix: "/done", allowed: ["PENDING"], okStatus: 200 },
  { id: "E-11", action: "undo-done", method: "POST", suffix: "/undo-done", allowed: ["DONE"], okStatus: 200 },
  { id: "E-12", action: "snooze", method: "POST", suffix: "/snooze", allowed: ["PENDING"], body: { days: 3 }, okStatus: 200 },
  { id: "E-13", action: "reschedule", method: "POST", suffix: "/reschedule", allowed: ["PENDING"], body: { date: "2026-06-16" }, okStatus: 200 },
  { id: "E-14", action: "discard", method: "POST", suffix: "/discard", allowed: ["PENDING", "NEEDS_INPUT", "DORMANT"], okStatus: 200 },
  { id: "E-15", action: "restore", method: "POST", suffix: "/restore", allowed: ["DISCARDED"], okStatus: 200 },
  { id: "E-16", action: "reactivate", method: "POST", suffix: "/reactivate", allowed: ["DORMANT"], okStatus: 200 },
  { id: "E-17", action: "delete", method: "DELETE", suffix: "", allowed: ["DISCARDED"], okStatus: 204 },
];

const E17_TODO = "bug: E-17 no pide ReturnValuesOnConditionCheckFailure, toda falla condicional responde 404";

/** Estados que la ConditionExpression enviada acepta (valores de `#s = :x` / `#s IN (...)`). */
function conditionStatuses(input: CommandInput): string[] {
  const statusClause = String(input.ConditionExpression).split(" AND ")[0];
  const placeholders = statusClause.match(/:\w+/g) ?? [];
  return placeholders.map((p) => input.ExpressionAttributeValues[p]);
}

/**
 * Tabla falsa con un solo ítem (o vacía). Igual que DynamoDB: la falla condicional solo
 * incluye `Item` si el comando pidió `ReturnValuesOnConditionCheckFailure: "ALL_OLD"`.
 */
function fakeTable(item?: { status: Status; version: number }) {
  return mockDdb((input) => {
    const ok =
      item !== undefined &&
      conditionStatuses(input).includes(item.status) &&
      item.version === input.ExpressionAttributeValues[":v"];
    if (!ok) {
      throw conditionalFailure(input.ReturnValuesOnConditionCheckFailure === "ALL_OLD" ? item : undefined);
    }
    const newVersion = input.ExpressionAttributeValues[":newVersion"];
    return newVersion === undefined ? {} : { Attributes: { ...item, version: newVersion } };
  });
}

function call(a: Action, opts: { ifMatch?: string; body?: unknown; rawBody?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.ifMatch !== undefined) headers["if-match"] = opts.ifMatch;
  const jsonBody = opts.body ?? a.body;
  const body = opts.rawBody ?? (jsonBody === undefined ? undefined : JSON.stringify(jsonBody));
  return dispatch(
    makeEvent({ method: a.method, path: `/v1/items/${TEST_VIDEO_ID}${a.suffix}`, headers, body }),
    TEST_CORRELATION_ID,
  );
}

function assertProblem(res: APIGatewayProxyStructuredResultV2, status: number, code: string) {
  assert.equal(res.statusCode, status, `body: ${res.body}`);
  assert.equal(res.headers?.["Content-Type"], "application/problem+json");
  assert.equal(parseBody(res).code, code);
}

for (const a of ACTIONS) {
  describe(`${a.id} ${a.action}`, () => {
    it(`ConditionExpression acepta exactamente ${a.allowed.join(", ")} (RF §4.4)`, async () => {
      mock.timers.enable({ apis: ["Date"], now: NOW });
      const ddb = fakeTable({ status: a.allowed[0], version: 3 });
      await call(a, { ifMatch: '"3"' });
      assert.deepEqual(conditionStatuses(ddb.inputs[0]).sort(), [...a.allowed].sort());
    });

    for (const from of a.allowed) {
      it(`desde ${from} → ${a.okStatus}, ETag y version+1`, async () => {
        mock.timers.enable({ apis: ["Date"], now: NOW });
        const ddb = fakeTable({ status: from, version: 3 });
        const res = await call(a, { ifMatch: '"3"' });

        assert.equal(res.statusCode, a.okStatus, `body: ${res.body}`);
        assert.equal(ddb.callCount, 1);
        const input = ddb.inputs[0];
        assert.equal(input.TableName, "test-table");
        assert.deepEqual(input.Key, { PK: `USER#${TEST_SUB}`, SK: `ITEM#${TEST_VIDEO_ID}` });
        assert.equal(input.ExpressionAttributeValues[":v"], 3);
        assert.match(input.ConditionExpression, /#v = :v/);
        if (a.okStatus === 200) {
          assert.equal(input.ExpressionAttributeValues[":newVersion"], 4);
          assert.equal(res.headers?.ETag, '"4"');
          assert.equal(parseBody(res).version, 4);
        }
      });
    }

    for (const from of ALL_STATES.filter((s) => !a.allowed.includes(s))) {
      it(
        `desde ${from} → 409 INVALID_STATE_TRANSITION`,
        a.action === "delete" ? { todo: E17_TODO } : {},
        async () => {
          mock.timers.enable({ apis: ["Date"], now: NOW });
          fakeTable({ status: from, version: 3 });
          const res = await call(a, { ifMatch: '"3"' });
          assertProblem(res, 409, "INVALID_STATE_TRANSITION");
          const body = parseBody(res);
          assert.equal(body.action, a.action);
          assert.equal(body.currentStatus, from);
          assert.deepEqual(body.allowedStatuses, a.allowed);
        },
      );
    }

    it("sin If-Match → 428 y no toca DynamoDB", async () => {
      const ddb = fakeTable({ status: a.allowed[0], version: 3 });
      const res = await call(a);
      assertProblem(res, 428, "PRECONDITION_REQUIRED");
      assert.equal(ddb.callCount, 0);
    });

    it(
      "If-Match con otra versión → 412 VERSION_MISMATCH con currentVersion",
      a.action === "delete" ? { todo: E17_TODO } : {},
      async () => {
        mock.timers.enable({ apis: ["Date"], now: NOW });
        fakeTable({ status: a.allowed[0], version: 5 });
        const res = await call(a, { ifMatch: '"3"' });
        assertProblem(res, 412, "VERSION_MISMATCH");
        assert.equal(parseBody(res).currentVersion, 5);
      },
    );

    it(
      "ítem inexistente → 404 ITEM_NOT_FOUND",
      { todo: "bug: sin Item en la falla condicional responde 412 (o 404 sin problem+json en E-17)" },
      async () => {
        mock.timers.enable({ apis: ["Date"], now: NOW });
        fakeTable(undefined);
        const res = await call(a, { ifMatch: '"3"' });
        assertProblem(res, 404, "ITEM_NOT_FOUND");
      },
    );

    it(
      'If-Match no numérico ("abc") → 4xx sin escribir en DynamoDB',
      { todo: "bug: Number('abc') = NaN se envía como :v" },
      async () => {
        mock.timers.enable({ apis: ["Date"], now: NOW });
        const ddb = fakeTable({ status: a.allowed[0], version: 3 });
        const res = await call(a, { ifMatch: '"abc"' });
        const status = res.statusCode ?? 0;
        assert.ok(status >= 400 && status < 500, `status ${status}`);
        assert.equal(ddb.callCount, 0);
      },
    );

    it("videoId inválido → 400 antes del handler", async () => {
      const ddb = fakeTable({ status: a.allowed[0], version: 3 });
      const res = await dispatch(
        makeEvent({ method: a.method, path: `/v1/items/corto${a.suffix}`, headers: { "if-match": '"3"' } }),
        TEST_CORRELATION_ID,
      );
      assertProblem(res, 400, "VALIDATION_ERROR");
      assert.equal(ddb.callCount, 0);
    });
  });
}

const [DONE, UNDO, SNOOZE, RESCHEDULE, DISCARD, RESTORE, REACTIVATE] = ACTIONS;

/** Ejecuta la acción desde su primer estado permitido y devuelve el input enviado a DynamoDB. */
async function sentInput(a: Action, body?: unknown) {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  const ddb = fakeTable({ status: a.allowed[0], version: 3 });
  const res = await call(a, { ifMatch: '"3"', body });
  return { res, input: ddb.inputs[0], ddb };
}

describe("E-10 / E-14: salen del índice de pendientes", () => {
  for (const a of [DONE, DISCARD]) {
    it(`${a.id} quita GSI1PK y GSI1SK`, async () => {
      const { input } = await sentInput(a);
      assert.match(input.UpdateExpression, /REMOVE GSI1PK, GSI1SK/);
    });
  }
});

describe("E-11 / E-15 / E-16: regresan al índice de pendientes", () => {
  for (const a of [UNDO, RESTORE, REACTIVATE]) {
    it(`${a.id} escribe GSI1PK = USER#sub`, async () => {
      const { input } = await sentInput(a);
      assert.equal(input.ExpressionAttributeValues[":gsi1pk"], `USER#${TEST_SUB}`);
    });
  }

  it(
    "E-11 GSI1SK con formato <fecha ISO>#<videoId>",
    { todo: "bug: E-11 antepone ':' al GSI1SK" },
    async () => {
      const { input } = await sentInput(UNDO);
      assert.match(input.ExpressionAttributeValues[":gsi1sk"], /^\d{4}-\d{2}-\d{2}T[^#]+#dQw4w9WgXcQ$/);
    },
  );
});

describe("E-12 snooze (RF §4.5)", () => {
  it("suma días a snoozeUntil, incrementa snoozeCount y borra scheduledFor", async () => {
    const { input } = await sentInput(SNOOZE, { days: 3 });
    assert.equal(input.ExpressionAttributeValues[":snoozeUntil"], "2026-06-18T18:00:00.000Z");
    assert.match(input.UpdateExpression, /snoozeCount = snoozeCount \+ :inc/);
    assert.match(input.UpdateExpression, /REMOVE scheduledFor/);
  });

  it("SNOOZE_UNIT=MINUTE usa minutos (modo demo)", async () => {
    process.env.SNOOZE_UNIT = "MINUTE";
    const { input } = await sentInput(SNOOZE, { days: 5 });
    assert.equal(input.ExpressionAttributeValues[":snoozeUntil"], "2026-06-15T18:05:00.000Z");
  });

  for (const days of [2, 0, "3", null]) {
    it(`days = ${JSON.stringify(days)} → 400 ENUM`, async () => {
      const { res, ddb } = await sentInput(SNOOZE, { days });
      assertProblem(res, 400, "VALIDATION_ERROR");
      assert.equal(parseBody(res).errors[0].pointer, "/days");
      assert.equal(ddb.callCount, 0);
    });
  }

  it("respeta SNOOZE_OPTIONS", async () => {
    process.env.SNOOZE_OPTIONS = "7";
    const { res } = await sentInput(SNOOZE, { days: 7 });
    assert.equal(res.statusCode, 200);
  });

  it("body con JSON inválido → 400 INVALID_JSON", { todo: "bug: JSON.parse lanza y termina en 500" }, async () => {
    fakeTable({ status: "PENDING", version: 3 });
    const res = await call(SNOOZE, { ifMatch: '"3"', rawBody: "{no-json" });
    assertProblem(res, 400, "INVALID_JSON");
  });
});

describe("E-13 reschedule (RF §4.5)", () => {
  for (const date of ["2026-06-15", "2026-06-16", "2027-06-15"]) {
    it(`fecha ${date} → 200, guarda scheduledFor y borra snoozeUntil`, async () => {
      const { res, input } = await sentInput(RESCHEDULE, { date });
      assert.equal(res.statusCode, 200, `body: ${res.body}`);
      assert.equal(input.ExpressionAttributeValues[":date"], date);
      assert.match(input.UpdateExpression, /REMOVE snoozeUntil/);
    });
  }

  const invalid: Array<[string, unknown, string]> = [
    ["fecha pasada", "2026-06-14", "pasada"],
    ["más de 365 días", "2027-06-16", "INVALID_DATE"],
    ["fecha imposible", "2026-02-30", "INVALID_DATE"],
    ["formato dd/mm/aaaa", "16/06/2026", "INVALID_DATE"],
    ["no string", 20260616, "INVALID_TYPE"],
  ];
  for (const [name, date, code] of invalid) {
    it(`${name} → 400 y no toca DynamoDB`, async () => {
      const { res, ddb } = await sentInput(RESCHEDULE, { date });
      assertProblem(res, 400, "VALIDATION_ERROR");
      const error = parseBody(res).errors[0];
      assert.equal(error.pointer, "/date");
      if (code !== "pasada") assert.equal(error.code, code);
      assert.equal(ddb.callCount, 0);
    });
  }

  it(
    "fecha pasada → código DATE_IN_PAST (contrato E-13)",
    { todo: "bug: busca 'past' en el mensaje 'must be today or later' y responde INVALID_DATE" },
    async () => {
      const { res } = await sentInput(RESCHEDULE, { date: "2026-06-14" });
      assert.equal(parseBody(res).errors[0].code, "DATE_IN_PAST");
    },
  );
});

describe("E-14 discard", () => {
  it("expiresAt = ahora + 30 días (epoch en segundos)", async () => {
    const { input } = await sentInput(DISCARD);
    assert.equal(input.ExpressionAttributeValues[":expiresAt"], NOW.getTime() / 1000 + 30 * 86400);
  });

  it("respeta DISCARD_RETENTION_DAYS", async () => {
    process.env.DISCARD_RETENTION_DAYS = "7";
    const { input } = await sentInput(DISCARD);
    assert.equal(input.ExpressionAttributeValues[":expiresAt"], NOW.getTime() / 1000 + 7 * 86400);
  });
});

describe("E-15 restore (T-10)", () => {
  it("reinicia notifyCount y snoozeCount a 0 y borra expiresAt", async () => {
    const { input } = await sentInput(RESTORE);
    assert.match(input.UpdateExpression, /notifyCount = :zero/);
    assert.match(input.UpdateExpression, /snoozeCount = :zero/);
    assert.equal(input.ExpressionAttributeValues[":zero"], 0);
    assert.match(input.UpdateExpression, /REMOVE expiresAt/);
  });

  it(
    "UpdateExpression sin operador ternario (no existe en DynamoDB)",
    { todo: "bug: 'SET #s = if_not_exists(...) = :null ? … : …' es inválido; DynamoDB rechazará el comando" },
    async () => {
      const { input } = await sentInput(RESTORE);
      assert.doesNotMatch(input.UpdateExpression, /\?/);
    },
  );
});

describe("E-16 reactivate", () => {
  it("reinicia notifyCount a 0", async () => {
    const { input } = await sentInput(REACTIVATE);
    assert.match(input.UpdateExpression, /notifyCount = :zero/);
  });
});
