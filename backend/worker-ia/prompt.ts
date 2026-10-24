import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

declare const __dirname: string | undefined;

// Determina el directorio del módulo, ya sea en CommonJS (con __dirname) o en ESM (con import.meta.url).
const moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(moduleDir, "prompts", "analysis.v1.md");
const PROMPT_V1 = readFileSync(PROMPT_PATH, "utf8");

/**
 * Prompt v1 (prompts/analysis.v1.md, sin modificar), con el bloque SEARCH
 * siempre incluido (la búsqueda de Google está siempre activa). Nunca
 * incluye datos del usuario ni la fecha de hoy.
 */
export function buildPrompt(): string {
  return PROMPT_V1;
}
