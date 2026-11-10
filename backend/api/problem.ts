/**
 * Formato de errores
 */

import { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type ErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "PROFILE_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "NOTIFICATION_NOT_FOUND"
  | "ROUTE_NOT_FOUND"
  | "INVALID_STATE_TRANSITION"
  | "VERSION_MISMATCH"
  | "PAYLOAD_TOO_LARGE"
  | "PRECONDITION_REQUIRED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export interface ValidationIssue {
  pointer: string;
  code: string;
  message: string;
}

interface ProblemOptions {
  status: number;
  code: ErrorCode;
  title: string;
  detail?: string;
  type?: string;
  /** Headers extra de la respuesta HTTP, ej. ETag. */
  headers?: Record<string, string>;
  /** Extensiones adicionales del body (ej. action, currentStatus, errors). */
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

/** 400 VALIDATION_ERROR con un JSON Pointer por campo. */
export function buildValidationErrorResponse(
  errors: ValidationIssue[],
  correlationId: string,
): APIGatewayProxyStructuredResultV2 {
  return buildProblemResponse(
    new ProblemError({
      status: 400,
      code: "VALIDATION_ERROR",
      title: "Request validation failed",
      extensions: { errors },
    }),
    correlationId,
  );
}

/** 500 para cualquier error no controlado; nunca expone detalles internos. */
export function buildInternalErrorResponse(correlationId: string): APIGatewayProxyStructuredResultV2 {
  return buildProblemResponse(
    new ProblemError({ status: 500, code: "INTERNAL_ERROR", title: "Unexpected server error" }),
    correlationId,
  );
}
