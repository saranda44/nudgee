import { GoogleGenAI } from "@google/genai";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssmClient = new SSMClient({});
const API_KEY_PARAMETER = "/nudgee/GEMINI_API_KEY";

/** Se lee una sola vez por contenedor, no en cada invocación. */
let cachedApiKey: string | undefined;
let cachedClient: GoogleGenAI | undefined;

async function getClient(): Promise<GoogleGenAI> {
  if (cachedClient) return cachedClient;
  if (!cachedApiKey) {
    const result = await ssmClient.send(new GetParameterCommand({ Name: API_KEY_PARAMETER, WithDecryption: true }));
    const value = result.Parameter?.Value;
    if (!value) throw new Error(`${API_KEY_PARAMETER} no está configurado en SSM`);
    cachedApiKey = value;
  }
  cachedClient = new GoogleGenAI({ apiKey: cachedApiKey });
  return cachedClient;
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
  /** GEMINI_MODEL (config.ts). */
  model: string;
  timeoutMs: number;
}

/**
 * Llama a Gemini (Interactions API, @google/genai) con el video directo por
 * URL y la vista ai del schema ya limpiada, y devuelve el texto crudo (JSON)
 * de la respuesta. Lanza GeminiCallError en error de red/HTTP/timeout
 * (429/5xx/TIMEOUT), para que el handler (index.ts) decida el backoff.
 */
export async function analyzeWithGemini(videoUrl: string, prompt: string, schema: unknown, options: GeminiCallOptions): Promise<string> {
  const ai = await getClient();

  try {
    const interaction = await ai.interactions.create(
      {
        model: options.model,
        input: [
          { type: "text", text: prompt },
          { type: "video", uri: videoUrl },
        ],
        tools: [{ type: "google_search" }],
        response_format: { type: "text", mime_type: "application/json", schema },
      },
      { timeout_ms: options.timeoutMs },
    );

    if (!interaction.output_text) {
      throw new GeminiCallError("UNKNOWN", "Gemini no devolvió output_text");
    }
    return interaction.output_text;
  } catch (error) {
    throw classifyError(error);
  }
}

/**
 * El SDK lanza subclases internas (ej. RateLimitError). Por eso se lee `status` por
 * duck-typing en vez de depender de la identidad exacta de la clase.
 */
function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  return typeof candidate === "number" ? candidate : undefined;
}

function classifyError(error: unknown): GeminiCallError {
  if (error instanceof GeminiCallError) return error;

  const status = extractHttpStatus(error);
  if (status === 429) return new GeminiCallError("RATE_LIMIT", "429 de Gemini", error);
  if (status !== undefined && status >= 500) return new GeminiCallError("SERVER_ERROR", `${status} de Gemini`, error);
  if (status !== undefined) return new GeminiCallError("UNKNOWN", `${status} de Gemini`, error);

  // El timeout via `timeout_ms` aborta el fetch; el SDK no exporta su clase de
  // RequestTimeoutError, así que se detecta por nombre.
  if (error instanceof Error && error.name === "RequestTimeoutError") {
    return new GeminiCallError("TIMEOUT", "Gemini call timed out", error);
  }

  return new GeminiCallError("UNKNOWN", "Unclassified Gemini error", error);
}
