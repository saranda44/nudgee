/**
 * Cliente de la API (mismo origen, `/v1/*`). Agrega el Bearer, reintenta una vez tras
 * refrescar ante un 401 (Contratos §8) y convierte problem+json en ApiError con `code` estable.
 */

import { getAccessToken, refreshAccessToken, SessionExpiredError } from "../auth/session.ts";
import { fetchOrNetworkError } from "./network-error.ts";

export { NetworkError } from "./network-error.ts";

export interface ProblemFieldError {
  pointer: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  /** `code` del catálogo (Contratos §2.5); el del authorizer o de throttling no trae code. */
  readonly code: string;
  readonly problem: Record<string, unknown>;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, problem: Record<string, unknown>, retryAfter: string | null) {
    const code = typeof problem.code === "string" ? problem.code : `HTTP_${status}`;
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.problem = problem;
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    this.retryAfterSeconds = Number.isFinite(seconds) ? seconds : null;
  }

  get fieldErrors(): ProblemFieldError[] {
    return Array.isArray(this.problem.errors) ? (this.problem.errors as ProblemFieldError[]) : [];
  }
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  /** Versión del ítem sin comillas (ETag `"7"` → 7), para el If-Match siguiente. */
  version: number | null;
  location: string | null;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Versión del ítem para If-Match (Contratos §2.2). */
  ifMatch?: number;
  signal?: AbortSignal;
}

type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();

/** La app se suscribe para mandar a P-01 con "Tu sesión expiró. Vuelve a entrar." */
export function onSessionExpired(listener: Listener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

async function send(path: string, opts: RequestOptions, token: string): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.ifMatch !== undefined) headers["If-Match"] = `"${opts.ifMatch}"`;
  return fetchOrNetworkError(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
}

function parseVersion(etag: string | null): number | null {
  const match = etag?.match(/^(?:W\/)?"(\d+)"$/);
  return match ? Number(match[1]) : null;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    res = await send(path, opts, await getAccessToken());
    if (res.status === 401) res = await send(path, opts, await refreshAccessToken());
  } catch (error) {
    if (error instanceof SessionExpiredError) sessionExpiredListeners.forEach((l) => l());
    throw error;
  }
  if (res.status === 401) {
    sessionExpiredListeners.forEach((l) => l());
    throw new SessionExpiredError();
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined; // p. ej. un 502 del gateway en texto plano
  }
  if (!res.ok) {
    throw new ApiError(res.status, (json ?? {}) as Record<string, unknown>, res.headers.get("Retry-After"));
  }
  // Un 2xx con cuerpo que no es JSON no viene de la API (p. ej. el index.html de la SPA si el
  // proxy o el behavior /v1/* de CloudFront no enrutan): error explícito, nunca `data` undefined.
  if (text && json === undefined) {
    throw new ApiError(502, { code: "INTERNAL_ERROR" }, null);
  }
  return {
    status: res.status,
    data: json as T,
    version: parseVersion(res.headers.get("ETag")),
    location: res.headers.get("Location"),
  };
}
