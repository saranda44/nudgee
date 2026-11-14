/**
 * Sesión con Cognito Hosted UI: Authorization Code + PKCE (US-01–US-03, Contratos §8).
 *
 * - Access token: solo en memoria (un XSS no lo encuentra en storage; se pierde al recargar).
 * - Refresh token: IndexedDB (refresh-store.ts), 30 días.
 * - verifier/state: sessionStorage, de un solo uso, para sobrevivir al redirect del Hosted UI.
 */

import { fetchOrNetworkError } from "../api/network-error.ts";
import { config } from "../config.ts";
import { codeChallenge, randomUrlSafe } from "./pkce.ts";
import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from "./refresh-store.ts";

const PENDING_KEY = "nudgee.pkce";
/** Refrescar un poco antes de que venza, para no mandar un token a punto de expirar. */
const EXPIRY_MARGIN_MS = 60_000;

/** La sesión no se puede recuperar: hay que volver a P-01 ("Tu sesión expiró"). */
export class SessionExpiredError extends Error {
  constructor() {
    super("Sesión expirada");
    this.name = "SessionExpiredError";
  }
}

/** El Hosted UI regresó con error, el usuario canceló o el `state` no coincide. */
export class LoginFailedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "LoginFailedError";
  }
}

interface PendingLogin {
  verifier: string;
  state: string;
  returnTo: string;
}

let accessToken: { value: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;

const redirectUri = () => `${location.origin}${config.redirectPath}`;

/**
 * Solo rutas del propio origen: "/algo", nunca "//host" ni "/\host" (open redirect).
 * El destino viene de la URL (`?returnTo=`), así que no es confiable.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/** Arma la URL de /oauth2/authorize y guarda verifier + state para el callback. */
export async function buildAuthorizeUrl(returnTo: string): Promise<string> {
  const pending: PendingLogin = { verifier: randomUrlSafe(), state: randomUrlSafe(16), returnTo: safeReturnTo(returnTo) };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.cognitoClientId,
    redirect_uri: redirectUri(),
    scope: config.scopes,
    state: pending.state,
    code_challenge: await codeChallenge(pending.verifier),
    code_challenge_method: "S256",
  });
  return `${config.cognitoDomain}/oauth2/authorize?${params}`;
}

export async function startLogin(returnTo = "/"): Promise<void> {
  location.assign(await buildAuthorizeUrl(returnTo));
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<Response> {
  return fetchOrNetworkError(`${config.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.cognitoClientId, ...body }),
  });
}

function keepAccessToken(tokens: TokenResponse): string {
  accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  return tokens.access_token;
}

/**
 * P-00: valida `state`, intercambia el `code` por tokens y devuelve a dónde ir.
 * El pendiente se borra antes del intercambio: un `code` nunca se reutiliza.
 */
export async function completeLogin(callbackUrl: string): Promise<string> {
  const params = new URL(callbackUrl).searchParams;
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);

  if (params.get("error")) throw new LoginFailedError(params.get("error")!);
  const code = params.get("code");
  const pending = raw ? (JSON.parse(raw) as PendingLogin) : null;
  if (!code || !pending || params.get("state") !== pending.state) {
    throw new LoginFailedError("state o code inválido");
  }

  const res = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  });
  if (!res.ok) throw new LoginFailedError(`token endpoint ${res.status}`);

  const tokens = (await res.json()) as TokenResponse;
  if (!tokens.refresh_token) throw new LoginFailedError("sin refresh token");
  await saveRefreshToken(tokens.refresh_token);
  keepAccessToken(tokens);
  return pending.returnTo;
}

/**
 * Pide un access token nuevo con el refresh token. Un solo refresco a la vez aunque varias
 * peticiones reciban 401 al mismo tiempo. Si Cognito rechaza el refresh token (400), la sesión
 * terminó; si es un error de red, se propaga sin cerrar la sesión (NFR-12, modo offline).
 */
export function refreshAccessToken(): Promise<string> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await loadRefreshToken();
      if (!refreshToken) throw new SessionExpiredError();
      const res = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      if (res.status === 400 || res.status === 401) {
        await clearRefreshToken();
        accessToken = null;
        throw new SessionExpiredError();
      }
      if (!res.ok) throw new Error(`token endpoint ${res.status}`);
      return keepAccessToken((await res.json()) as TokenResponse);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Access token vigente; refresca si no hay o está por vencer. */
export async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return accessToken.value;
  return refreshAccessToken();
}

/** ¿Hay sesión recuperable? (no valida con Cognito; eso lo hace el primer getAccessToken). */
export async function hasSession(): Promise<boolean> {
  return accessToken !== null || (await loadRefreshToken()) !== null;
}

/**
 * US-03: revoca el refresh token y cierra la sesión del Hosted UI. Quien llama debe quitar
 * antes la suscripción push de este dispositivo (E-21).
 */
export async function logout(): Promise<void> {
  const refreshToken = await loadRefreshToken();
  accessToken = null;
  await clearRefreshToken();
  if (refreshToken) {
    // Si falla (sin red), el token igual queda borrado del dispositivo.
    await fetch(`${config.cognitoDomain}/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken, client_id: config.cognitoClientId }),
    }).catch(() => undefined);
  }
  const params = new URLSearchParams({ client_id: config.cognitoClientId, logout_uri: `${location.origin}${config.logoutPath}` });
  location.assign(`${config.cognitoDomain}/logout?${params}`);
}

/** Solo para tests. */
export function _resetForTests(): void {
  accessToken = null;
  refreshing = null;
}
