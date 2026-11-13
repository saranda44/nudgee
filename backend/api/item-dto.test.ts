/**
 * Tests del recurso público Item (Contratos §2.3).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { itemResponse, toItemDto } from "./item-dto.ts";

const raw = {
  PK: "USER#abc",
  SK: "ITEM#dQw4w9WgXcQ",
  GSI1PK: "USER#abc",
  GSI1SK: "2026-06-01T10:00:00.000Z#dQw4w9WgXcQ",
  entityType: "ITEM",
  userId: "abc",
  aiOriginal: { title: "original" },
  correlationId: "corr-1",
  eventDate: "2026-07-01",
  videoId: "dQw4w9WgXcQ",
  status: "PENDING",
  category: "RECIPE",
  details: { ingredients: [{ id: "i1", text: "pasta" }, { id: "i2", text: "ajo" }] },
  checklist: { i1: true, i2: true },
  snoozeCount: 3,
  version: 4,
};

describe("toItemDto", () => {
  it("no expone atributos internos (D-10)", () => {
    const dto = toItemDto(raw);
    for (const field of ["PK", "SK", "GSI1PK", "GSI1SK", "entityType", "userId", "aiOriginal", "correlationId", "eventDate"]) {
      assert.equal(field in dto, false, `${field} no debe salir`);
    }
  });

  it("campos ausentes salen como null y contadores en 0", () => {
    const dto = toItemDto({ videoId: "dQw4w9WgXcQ", status: "PROCESSING", version: 1 });
    assert.equal(dto.title, null);
    assert.equal(dto.snoozeUntil, null);
    assert.deepEqual(dto.checklist, {});
    assert.equal(dto.snoozeCount, 0);
    assert.equal(dto.notifyCount, 0);
    assert.equal(dto.suggestDiscard, false);
    assert.equal(dto.suggestDone, false);
  });

  it("suggestDiscard con snoozeCount >= 3 (US-21)", () => {
    assert.equal(toItemDto(raw).suggestDiscard, true);
  });

  it("suggestDone si todas las entradas están marcadas (US-46)", () => {
    assert.equal(toItemDto(raw).suggestDone, true);
    assert.equal(toItemDto({ ...raw, checklist: { i1: true } }).suggestDone, false);
  });

  it("suggestDone es false en categorías sin checklist", () => {
    assert.equal(toItemDto({ ...raw, category: "EVENT" }).suggestDone, false);
  });

  it("itemResponse agrega ETag con la versión", () => {
    const res = itemResponse(raw);
    assert.equal(res.headers?.ETag, '"4"');
    assert.equal(JSON.parse(res.body as string).userId, undefined);
  });
});
