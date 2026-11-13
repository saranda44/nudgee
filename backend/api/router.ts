/**
 * Router interno de la Lambda API: despacha por método + rawPath hacia el
 * handler registrado, valida el formato de los parámetros de ruta y responde 404 ROUTE_NOT_FOUND si nada coincide.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ProblemError, buildProblemResponse, buildValidationErrorResponse } from "./problem.ts";

export interface HandlerContext {
  event: APIGatewayProxyEventV2;
  correlationId: string;
  /** `null` solo en rutas con `auth: false` (hoy, únicamente E-01 /health). */
  userId: string | null;
  params: Record<string, string>;
}

export interface Route {
  method: string;
  /** Ruta con parámetros como `:nombre`, ej. "/v1/items/:videoId". */
  path: string;
  auth: boolean;
  handler: (ctx: HandlerContext) => Promise<APIGatewayProxyStructuredResultV2>;
}

interface CompiledRoute extends Route {
  regex: RegExp;
  paramNames: string[];
}

/** Formato de cada parámetro de ruta*/
const PARAM_PATTERNS: Record<string, RegExp> = {
  videoId: /^[A-Za-z0-9_-]{11}$/,
  slotKey: /^\d{4}-\d{2}-\d{2}T\d{2}$/,
  subscriptionId: /^[a-f0-9]{64}$/,
};

function compileRoute(route: Route): CompiledRoute {
  const paramNames: string[] = [];
  const pattern = route.path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { ...route, regex: new RegExp(`^${pattern}$`), paramNames };
}

/** El `userId` siempre es el `sub` del access token (NFR-05), nunca del request. */
function getUserId(event: APIGatewayProxyEventV2): string {
  const claims = (
    event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } }
  ).authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Missing sub claim: la ruta debe estar protegida por el authorizer JWT");
  }
  return sub;
}

/** Red de seguridad para handlers de rutas `auth: true`: userId nunca es null ahí. */
export function requireUserId(ctx: HandlerContext): string {
  if (!ctx.userId) {
    throw new Error("requireUserId: la ruta no está marcada como auth: true");
  }
  return ctx.userId;
}

/**
 * Body JSON del request como objeto. Body ausente → `{}`; JSON inválido o que no sea
 * un objeto → 400 INVALID_JSON (lo convierte `dispatch`).
 */
export function readJsonBody(ctx: HandlerContext): Record<string, unknown> {
  const raw = ctx.event.body;
  if (!raw) return {};
  const text = ctx.event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProblemError({ status: 400, code: "INVALID_JSON", title: "Request body is not valid JSON" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProblemError({ status: 400, code: "INVALID_JSON", title: "Request body must be a JSON object" });
  }
  return parsed as Record<string, unknown>;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function withCorrelationId(
  result: APIGatewayProxyStructuredResultV2,
  correlationId: string,
): APIGatewayProxyStructuredResultV2 {
  return { ...result, headers: { ...(result.headers ?? {}), "X-Correlation-Id": correlationId } };
}

export function createRouter(routes: Route[]) {
  const compiled = routes.map(compileRoute);

  return async function dispatch(
    event: APIGatewayProxyEventV2,
    correlationId: string,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    for (const route of compiled) {
      if (route.method !== method) continue;
      const match = route.regex.exec(path);
      if (!match) continue;

      const params: Record<string, string> = {};
      const formatIssues: Array<{ pointer: string; code: string; message: string }> = [];
      route.paramNames.forEach((name, index) => {
        const decoded = safeDecode(match[index + 1]);
        if (decoded === null || (PARAM_PATTERNS[name] && !PARAM_PATTERNS[name].test(decoded))) {
          formatIssues.push({ pointer: `/${name}`, code: "INVALID_FORMAT", message: `${name} has an invalid format` });
        } else {
          params[name] = decoded;
        }
      });
      if (formatIssues.length > 0) {
        return withCorrelationId(buildValidationErrorResponse(formatIssues, correlationId), correlationId);
      }

      const userId = route.auth ? getUserId(event) : null;
      try {
        const result = await route.handler({ event, correlationId, userId, params });
        return withCorrelationId(result, correlationId);
      } catch (error) {
        // Los handlers pueden lanzar ProblemError para cortar con un 4xx (ej. readJsonBody).
        if (error instanceof ProblemError) {
          return withCorrelationId(buildProblemResponse(error, correlationId), correlationId);
        }
        throw error;
      }
    }

    return withCorrelationId(
      buildProblemResponse(
        new ProblemError({ status: 404, code: "ROUTE_NOT_FOUND", title: "Route not found" }),
        correlationId,
      ),
      correlationId,
    );
  };
}
