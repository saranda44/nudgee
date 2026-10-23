/**
 * Errores en formato RFC 9457 (application/problem+json) con extensión `code` estable.
 */

import { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type ErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "INVALID_URL"
  | "DUPLICATE_ITEM"
  | "QUOTA_EXCEEDED"
  | "PAYLOAD_TOO_LARGE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

interface ProblemOptions {
  status: number;
  code: ErrorCode;
  title: string;
  detail?: string;
  type?: string;
  /** Headers extra de la respuesta HTTP, ej. Retry-After. */
  headers?: Record<string, string>;
  /** Extensiones adicionales del body (ej. `existing`, `window`, `limit`). */
  extensions?: Record<string, unknown>;
}

const PROBLEM_BASE_URL = "https://nudgee.app/errors";

/** Error de aplicación que el handler atrapa y convierte en respuesta HTTP. */
export class ProblemError extends Error {
  readonly options: ProblemOptions;

  constructor(options: ProblemOptions) {
    super(options.title);
    this.name = "ProblemError";
    this.options = options;
  }
}

function slugify(code: ErrorCode): string {
  return code.toLowerCase().replace(/_/g, "-");
}

export function buildProblemResponse(
  error: ProblemError,
  correlationId: string,
): APIGatewayProxyStructuredResultV2 {
  const { status, code, title, detail, type, headers, extensions } = error.options;

  const body: Record<string, unknown> = {
    type: type ?? `${PROBLEM_BASE_URL}/${slugify(code)}`,
    title,
    status,
    code,
    correlationId,
    ...(detail ? { detail } : {}),
    ...(extensions ?? {}),
  };

  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/problem+json",
      "X-Correlation-Id": correlationId,
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  };
}

/** 500 para cualquier error no controlado; nunca expone detalles internos. */
export function buildInternalErrorResponse(correlationId: string): APIGatewayProxyStructuredResultV2 {
  return buildProblemResponse(
    new ProblemError({ status: 500, code: "INTERNAL_ERROR", title: "Unexpected server error" }),
    correlationId,
  );
}
