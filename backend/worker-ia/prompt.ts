import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Ruta relativa al propio archivo: igual en el código fuente (junto a prompt.ts)
// y en el paquete ya armado (scripts/build.mjs copia prompts/ junto a index.js).
const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompts", "analysis.v1.md");
const PROMPT_V1 = readFileSync(PROMPT_PATH, "utf8");

const SEARCH_HEADER = "# SEARCH\n";
const DATES_HEADER = "# DATES (EVENT)";
const SEARCH_CONFIRMATION_PHRASE = " or confirmed by search";

export interface BuildPromptOptions {
  groundingEnabled: boolean;
}

/**
 * Prompt v1 (prompts/analysis.v1.md, sin modificar). Sin ENABLE_GROUNDING se
 * omite el bloque SEARCH completo y la frase "or confirmed by search" del
 * bloque DATES. Nunca incluye datos del usuario ni la fecha de hoy (PRM-02).
 */
export function buildPrompt(options: BuildPromptOptions): string {
  if (options.groundingEnabled) {
    return PROMPT_V1;
  }

  const searchStart = PROMPT_V1.indexOf(SEARCH_HEADER);
  const datesStart = PROMPT_V1.indexOf(DATES_HEADER);
  if (searchStart === -1 || datesStart === -1 || datesStart < searchStart) {
    throw new Error("buildPrompt: no encontré los bloques SEARCH/DATES; revisa prompts/analysis.v1.md");
  }

  const withoutSearchBlock = PROMPT_V1.slice(0, searchStart) + PROMPT_V1.slice(datesStart);
  return withoutSearchBlock.replace(SEARCH_CONFIRMATION_PHRASE, "");
}
