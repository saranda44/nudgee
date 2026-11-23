import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, parseVideoPool, percentile, shouldAbort } from "./plan.ts";

test("buildPlan no repite usuario + videoId y respeta perUser", () => {
  const videos = ["a", "b", "c", "d"];
  const plan = buildPlan(3, videos, 2, 1000);
  assert.equal(plan.length, 6);
  const keys = new Set(plan.map((r) => `${r.userIndex}#${r.videoId}`));
  assert.equal(keys.size, plan.length);
  for (let u = 0; u < 3; u++) assert.equal(plan.filter((r) => r.userIndex === u).length, 2);
});

test("buildPlan intercala usuarios para repartir la carga", () => {
  const plan = buildPlan(3, ["a", "b", "c"], 2, 1000);
  assert.deepEqual(plan.slice(0, 3).map((r) => r.userIndex), [0, 1, 2]);
});

test("buildPlan limita por pool, por cuota horaria y por maxRequests", () => {
  assert.equal(buildPlan(2, ["a", "b"], 25, 1000).length, 4); // pool de 2
  const pool = Array.from({ length: 40 }, (_, i) => `v${i}`);
  assert.equal(buildPlan(1, pool, 40, 1000).length, 30); // cuota de 30/h
  assert.equal(buildPlan(35, pool, 25, 900).length, 875); // 35 × 25 cabe en el tope
  assert.equal(buildPlan(40, pool, 25, 900).length, 900); // 40 × 25 = 1000 se corta en el tope
  assert.deepEqual(buildPlan(0, pool, 5, 10), []);
});

test("percentile por rango más cercano", () => {
  const v = [50, 10, 40, 20, 30];
  assert.equal(percentile(v, 50), 30);
  assert.equal(percentile(v, 95), 50);
  assert.equal(percentile([], 95), 0);
});

test("shouldAbort espera una muestra mínima y luego corta arriba del 5 %", () => {
  assert.equal(shouldAbort(10, 10), false);
  assert.equal(shouldAbort(100, 5), false);
  assert.equal(shouldAbort(100, 6), true);
});

test("parseVideoPool ignora comentarios, vacíos y repetidos; reporta inválidos", () => {
  const { videos, invalid } = parseVideoPool("# pool\nlipJRiztOgM\n\nlipJRiztOgM # repetido\nno-es-id\nVWJX4f-AJZA\n");
  assert.deepEqual(videos, ["lipJRiztOgM", "VWJX4f-AJZA"]);
  assert.deepEqual(invalid, ["no-es-id"]);
});
