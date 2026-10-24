/** Logs JSON con correlationId propagado; nunca email, nombre ni texto del video. */
export function logInfo(message: string, correlationId: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", correlationId, message, ...extra }));
}

export function logError(message: string, correlationId: string, error: unknown, extra?: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", correlationId, message, error: String(error), ...extra }));
}
