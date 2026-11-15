/** El cliente nunca devuelve `data` undefined ante un 2xx que no es JSON (p. ej. proxy caído). */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveRefreshToken } from "../auth/refresh-store.ts";
import { _resetForTests } from "../auth/session.ts";
import { api, ApiError } from "./client.ts";

beforeEach(async () => {
  vi.stubGlobal("location", { origin: "http://localhost:5173", assign: vi.fn() });
  _resetForTests();
  await saveRefreshToken("RT");
});
afterEach(() => vi.unstubAllGlobals());

const token = () => new Response(JSON.stringify({ access_token: "AT", expires_in: 3600 }), { status: 200 });

it("200 con HTML (index.html de la SPA) → ApiError, no data undefined", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response("<!doctype html>", { status: 200 })));
  await expect(api("/v1/items")).rejects.toBeInstanceOf(ApiError);
});

it("204 sin cuerpo sigue siendo válido", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response(null, { status: 204 })));
  expect((await api("/v1/notifications/2026-06-15T09/open", { method: "POST" })).status).toBe(204);
});
