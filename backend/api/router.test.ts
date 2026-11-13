/**
 * Tests del router interno de la Lambda API (api/router.ts).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRouter, requireUserId, type HandlerContext, type Route } from "./router.ts";
import { makeEvent, parseBody, TEST_CORRELATION_ID, TEST_SUB, TEST_VIDEO_ID } from "./test-helpers.ts";

/** Ruta falsa que devuelve el contexto recibido para inspeccionarlo. */
function echoRoute(method: string, path: string, auth = true): Route {
  return {
    method,
    path,
    auth,
    handler: async (ctx: HandlerContext) => ({
      statusCode: 200,
      body: JSON.stringify({ userId: ctx.userId, params: ctx.params, correlationId: ctx.correlationId }),
    }),
  };
}

const dispatch = createRouter([
  echoRoute("GET", "/v1/health", false),
  echoRoute("GET", "/v1/items/:videoId"),
  echoRoute("POST", "/v1/items/:videoId/done"),
  echoRoute("GET", "/v1/slots/:slotKey"),
  echoRoute("DELETE", "/v1/push-subscriptions/:subscriptionId"),
  echoRoute("GET", "/v1/things/:freeParam"),
]);

describe("router: coincidencia de rutas", () => {
  it("despacha por método + ruta y extrae params", async () => {
    const res = await dispatch(makeEvent({ method: "GET", path: `/v1/items/${TEST_VIDEO_ID}` }), TEST_CORRELATION_ID);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseBody(res).params, { videoId: TEST_VIDEO_ID });
  });

  it("distingue subrutas (/done no coincide con /:videoId)", async () => {
    const res = await dispatch(makeEvent({ method: "POST", path: `/v1/items/${TEST_VIDEO_ID}/done` }), TEST_CORRELATION_ID);
    assert.equal(res.statusCode, 200);
  });

  it("ruta inexistente → 404 ROUTE_NOT_FOUND en problem+json", async () => {
    const res = await dispatch(makeEvent({ method: "GET", path: "/v1/nope" }), TEST_CORRELATION_ID);
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers?.["Content-Type"], "application/problem+json");
    assert.equal(parseBody(res).code, "ROUTE_NOT_FOUND");
  });

  it("mismo path con otro método → 404", async () => {
    const res = await dispatch(makeEvent({ method: "DELETE", path: "/v1/health" }), TEST_CORRELATION_ID);
    assert.equal(res.statusCode, 404);
  });

  it("no hace match parcial (prefijo o sufijo extra)", async () => {
    const extra = await dispatch(makeEvent({ method: "GET", path: "/v1/health/x" }), TEST_CORRELATION_ID);
    const slash = await dispatch(makeEvent({ method: "GET", path: "/v1/health/" }), TEST_CORRELATION_ID);
    assert.equal(extra.statusCode, 404);
    assert.equal(slash.statusCode, 404);
  });

  it("decodifica params con encodeURIComponent", async () => {
    const res = await dispatch(makeEvent({ method: "GET", path: "/v1/things/a%20b" }), TEST_CORRELATION_ID);
    assert.equal(parseBody(res).params.freeParam, "a b");
  });

  it(
    "param con escape % inválido → 400, no 500",
    async () => {
      const res = await dispatch(makeEvent({ method: "GET", path: "/v1/things/%E0" }), TEST_CORRELATION_ID);
      assert.equal(res.statusCode, 400);
    },
  );
});

describe("router: validación de PARAM_PATTERNS", () => {
  const invalid: Array<[string, string, string]> = [
    ["videoId de 10 chars", "GET", "/v1/items/dQw4w9WgXc"],
    ["videoId de 12 chars", "GET", "/v1/items/dQw4w9WgXcQQ"],
    ["videoId con caracter inválido", "GET", "/v1/items/dQw4w9WgX.Q"],
    ["slotKey sin hora", "GET", "/v1/slots/2026-11-13"],
    ["subscriptionId que no es sha256 hex", "DELETE", "/v1/push-subscriptions/abc"],
  ];

  for (const [name, method, path] of invalid) {
    it(`${name} → 400 VALIDATION_ERROR con pointer e INVALID_FORMAT`, async () => {
      const res = await dispatch(makeEvent({ method, path }), TEST_CORRELATION_ID);
      assert.equal(res.statusCode, 400);
      const body = parseBody(res);
      assert.equal(body.code, "VALIDATION_ERROR");
      assert.equal(body.errors.length, 1);
      assert.equal(body.errors[0].code, "INVALID_FORMAT");
      assert.match(body.errors[0].pointer, /^\/(videoId|slotKey|subscriptionId)$/);
    });
  }

  it("acepta slotKey y subscriptionId válidos", async () => {
    const slot = await dispatch(makeEvent({ method: "GET", path: "/v1/slots/2026-11-13T09" }), TEST_CORRELATION_ID);
    const sub = await dispatch(
      makeEvent({ method: "DELETE", path: `/v1/push-subscriptions/${"a1".repeat(32)}` }),
      TEST_CORRELATION_ID,
    );
    assert.equal(slot.statusCode, 200);
    assert.equal(sub.statusCode, 200);
  });

  it("params sin patrón definido no se validan", async () => {
    const res = await dispatch(makeEvent({ method: "GET", path: "/v1/things/cualquier-cosa" }), TEST_CORRELATION_ID);
    assert.equal(res.statusCode, 200);
  });
});

describe("router: X-Correlation-Id", () => {
  const cases: Array<[string, string, string]> = [
    ["éxito", "GET", "/v1/health"],
    ["404", "GET", "/v1/nope"],
    ["400", "GET", "/v1/items/corto"],
  ];
  for (const [name, method, path] of cases) {
    it(`se agrega en respuesta de ${name}`, async () => {
      const res = await dispatch(makeEvent({ method, path }), TEST_CORRELATION_ID);
      assert.equal(res.headers?.["X-Correlation-Id"], TEST_CORRELATION_ID);
    });
  }

  it("se pasa al handler", async () => {
    const res = await dispatch(makeEvent({ method: "GET", path: "/v1/health" }), TEST_CORRELATION_ID);
    assert.equal(parseBody(res).correlationId, TEST_CORRELATION_ID);
  });
});

describe("router: userId (NFR-05)", () => {
  it("ruta auth: true → userId = claims.sub", async () => {
    const res = await dispatch(makeEvent({ method: "GET", path: `/v1/items/${TEST_VIDEO_ID}` }), TEST_CORRELATION_ID);
    assert.equal(parseBody(res).userId, TEST_SUB);
  });

  it("ruta auth: true sin sub → lanza (debe estar detrás del authorizer)", async () => {
    await assert.rejects(
      dispatch(makeEvent({ method: "GET", path: `/v1/items/${TEST_VIDEO_ID}`, sub: null }), TEST_CORRELATION_ID),
      /Missing sub claim/,
    );
  });

  it("ruta auth: true con sub vacío → lanza", async () => {
    await assert.rejects(
      dispatch(makeEvent({ method: "GET", path: `/v1/items/${TEST_VIDEO_ID}`, sub: "" }), TEST_CORRELATION_ID),
      /Missing sub claim/,
    );
  });

  it("ruta auth: false → userId null aunque no haya claims", async () => {
    const res = await dispatch(makeEvent({ method: "GET", path: "/v1/health", sub: null }), TEST_CORRELATION_ID);
    assert.equal(parseBody(res).userId, null);
  });

  it("requireUserId lanza si userId es null", () => {
    const ctx = { userId: null } as HandlerContext;
    assert.throws(() => requireUserId(ctx), /auth: true/);
  });

  it("requireUserId devuelve el userId", () => {
    const ctx = { userId: TEST_SUB } as HandlerContext;
    assert.equal(requireUserId(ctx), TEST_SUB);
  });
});
