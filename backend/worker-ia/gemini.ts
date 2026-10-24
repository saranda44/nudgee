import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssmClient = new SSMClient({});
const API_KEY_PARAMETER = "/nudgee/GEMINI_API_KEY";

/** Se lee una sola vez por contenedor, no en cada invocación. */
let cachedApiKey: string | undefined;

async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const result = await ssmClient.send(new GetParameterCommand({ Name: API_KEY_PARAMETER, WithDecryption: true }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`${API_KEY_PARAMETER} no está configurado en SSM`);
  cachedApiKey = value;
  return value;
}

export type GeminiErrorKind = "RATE_LIMIT" | "SERVER_ERROR" | "TIMEOUT" | "UNKNOWN";

export class GeminiCallError extends Error {
  readonly kind: GeminiErrorKind;
  readonly errorCause?: unknown;

  constructor(kind: GeminiErrorKind, message: string, errorCause?: unknown) {
    super(message);
    this.name = "GeminiCallError";
    this.kind = kind;
    this.errorCause = errorCause;
  }
}

export interface GeminiCallOptions {
  groundingEnabled: boolean;
  timeoutMs: number;
}

/**
 * Llama a Gemini y devuelve el texto crudo (JSON) de la respuesta.
 * Lanza GeminiCallError en error de red/HTTP/timeout (429/5xx/TIMEOUT), para
 * que el handler (index.ts) decida el backoff.
 */
export async function analyzeWithGemini(videoUrl: string, prompt: string, schema: unknown, options: GeminiCallOptions): Promise<string> {
  const apiKey = await getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    // TODO (pendiente de AI Studio):
    // llamar al SDK de Gemini con apiKey, videoUrl, prompt, schema (ya
    // limpiada para Gemini) y, si options.groundingEnabled, la herramienta
    // de búsqueda de Google. Usar controller.signal para el timeout.
    throw new Error("analyzeWithGemini: pendiente de implementar con el SDK elegido en AI Studio");
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GeminiCallError("TIMEOUT", "Gemini call timed out", error);
    }
    throw classifyError(error);
  } finally {
    clearTimeout(timeout);
  }
}

/** TODO: ajustar según la forma real de los errores del SDK elegido (status 429 / 5xx, etc.). */
function classifyError(error: unknown): GeminiCallError {
  if (error instanceof GeminiCallError) return error;
  return new GeminiCallError("UNKNOWN", "Unclassified Gemini error", error);
}
