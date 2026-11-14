/**
 * Tests del login PKCE y del refresco de sesión (lógica crítica: si falla, nadie entra).
 * IndexedDB con fake-indexeddb; fetch, location y sessionStorage simulados.
 */

import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "../api/network-error.ts";
import { codeChallenge, randomUrlSafe } from "./pkce.ts";
import { loadRefreshToken, saveRefreshToken } from "./refresh-store.ts";
import {
  _resetForTests,
  buildAuthorizeUrl,
  completeLogin,
  getAccessToken,
  LoginFailedError,
  refreshAccessToken,
  safeReturnTo,
  SessionExpiredError,
} from "./session.ts";

const ORIGIN = "http://localhost:5173";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const tokenJson = (extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ access_token: "AT", expires_in: 3600, ...extra }), { status: 200 });

beforeEach(async () => {
  vi.stubGlobal("location", { origin: ORIGIN, assign: vi.fn() });
  vi.stubGlobal("sessionStorage", memoryStorage());
  _resetForTests();
  indexedDB.deleteDatabase("nudgee");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PKCE (RFC 7636)", () => {
  it("code_challenge = base64url(SHA-256(verifier)), igual que node:crypto", async () => {
    const verifier = randomUrlSafe();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(await codeChallenge(verifier)).toBe(expected);
  });

  it("el verifier mide 43 caracteres URL-safe (mínimo del RFC)", () => {
    expect(randomUrlSafe()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("safeReturnTo (sin open redirect)", () => {
  it.each([
    ["/items/abc?slot=1", "/items/abc?slot=1"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    [null, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe("login", () => {
  async function startAndGetState(returnTo = "/reminders") {
    const url = new URL(await buildAuthorizeUrl(returnTo));
    return { url, state: url.searchParams.get("state")! };
  }

  it("la URL de authorize lleva S256, redirect a /auth/callback y los scopes de NFR-08", async () => {
    const { url } = await startAndGetState();
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/callback`);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  it("callback válido: manda el verifier, guarda el refresh token y regresa a returnTo", async () => {
    const { url, state } = await startAndGetState();
    const fetchMock = vi.fn().mockResolvedValue(tokenJson({ refresh_token: "RT" }));
    vi.stubGlobal("fetch", fetchMock);

    const returnTo = await completeLogin(`${ORIGIN}/auth/callback?code=C&state=${state}`);

    expect(returnTo).toBe("/reminders");
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(await codeChallenge(body.get("code_verifier")!)).toBe(url.searchParams.get("code_challenge"));
    expect(await loadRefreshToken()).toBe("RT");
    expect(await getAccessToken()).toBe("AT");
  });

  it("state distinto → LoginFailedError sin llamar a Cognito", async () => {
    await startAndGetState();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeLogin(`${ORIGIN}/auth/callback?code=C&state=otro`)).rejects.toBeInstanceOf(LoginFailedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el pendiente es de un solo uso: repetir el callback falla", async () => {
    const { state } = await startAndGetState();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenJson({ refresh_token: "RT" })));
    await completeLogin(`${ORIGIN}/auth/callback?code=C&state=${state}`);
    await expect(completeLogin(`${ORIGIN}/auth/callback?code=C&state=${state}`)).rejects.toBeInstanceOf(LoginFailedError);
  });

  it("usuario canceló en el Hosted UI (?error=) → LoginFailedError", async () => {
    await startAndGetState();
    await expect(completeLogin(`${ORIGIN}/auth/callback?error=access_denied`)).rejects.toBeInstanceOf(LoginFailedError);
  });
});

describe("refresco", () => {
  it("varios 401 a la vez hacen un solo refresco", async () => {
    await saveRefreshToken("RT");
    const fetchMock = vi.fn().mockResolvedValue(tokenJson());
    vi.stubGlobal("fetch", fetchMock);
    const tokens = await Promise.all([refreshAccessToken(), refreshAccessToken(), getAccessToken()]);
    expect(tokens).toEqual(["AT", "AT", "AT"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refresh token rechazado (400) → SessionExpiredError y se borra", async () => {
    await saveRefreshToken("RT");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 })));
    await expect(getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(await loadRefreshToken()).toBeNull();
  });

  it("sin red → error de red, pero la sesión se conserva (NFR-12)", async () => {
    await saveRefreshToken("RT");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(getAccessToken()).rejects.toBeInstanceOf(NetworkError);
    expect(await loadRefreshToken()).toBe("RT");
  });

  it("token por vencer (menos de 60 s) se refresca antes de usarlo", async () => {
    await saveRefreshToken("RT");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(tokenJson({ access_token: "A1", expires_in: 90 })).mockResolvedValueOnce(tokenJson({ access_token: "A2" })));
    expect(await getAccessToken()).toBe("A1");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 40_000);
    expect(await getAccessToken()).toBe("A2");
  });
});
