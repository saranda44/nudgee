/**
 * Piezas reutilizables de la normalización: limpiar
 * texto, listas marcables, pasos y entradas. Cada una regresa también cuánto
 * tuvo que ajustar, para las estadísticas de logs.
 */

export interface TextStats {
  truncated: number;
  droppedEmpty: number;
}

function emptyTextStats(): TextStats {
  return { truncated: 0, droppedEmpty: 0 };
}

/** `trim` + recorta al máximo; `undefined` si no es texto o queda vacío tras el trim. */
export function cleanText(value: unknown, maxLength: number, stats: TextStats): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    stats.droppedEmpty += 1;
    return undefined;
  }
  if (trimmed.length > maxLength) {
    stats.truncated += 1;
    return trimmed.slice(0, maxLength);
  }
  return trimmed;
}

export interface CheckListStats extends TextStats {
  /** Elementos descartados por completo (no eran objeto, o el texto quedó vacío). */
  droppedItems: number;
  trimmedList: boolean;
}

/** Lista de elementos marcables `{ text }` (ingredients, exercises, materials). */
export function cleanCheckList(value: unknown, opts: { maxTextLength: number; maxItems: number }): { items: { text: string }[]; stats: CheckListStats } {
  const stats: CheckListStats = { ...emptyTextStats(), droppedItems: 0, trimmedList: false };
  if (!Array.isArray(value)) return { items: [], stats };

  const items: { text: string }[] = [];
  for (const raw of value) {
    const text = typeof raw === "object" && raw !== null ? cleanText((raw as { text?: unknown }).text, opts.maxTextLength, stats) : undefined;
    if (text === undefined) {
      stats.droppedItems += 1;
      continue;
    }
    items.push({ text });
  }

  if (items.length > opts.maxItems) {
    items.length = opts.maxItems; // conserva los primeros
    stats.trimmedList = true;
  }
  return { items, stats };
}

/** Lista de pasos (texto plano, no marcable): RECIPE.steps, TUTORIAL.steps. */
export function cleanSteps(value: unknown, opts: { maxTextLength: number; maxItems: number }): { steps: string[]; stats: CheckListStats } {
  const stats: CheckListStats = { ...emptyTextStats(), droppedItems: 0, trimmedList: false };
  if (!Array.isArray(value)) return { steps: [], stats };

  const steps: string[] = [];
  for (const raw of value) {
    const text = cleanText(raw, opts.maxTextLength, stats);
    if (text === undefined) {
      stats.droppedItems += 1;
      continue;
    }
    steps.push(text);
  }

  if (steps.length > opts.maxItems) {
    steps.length = opts.maxItems;
    stats.trimmedList = true;
  }
  return { steps, stats };
}

/** Cuenta llaves de `value` que no están en `knownKeys` (descartar campos fuera del schema). */
export function countUnknownKeys(value: unknown, knownKeys: readonly string[]): number {
  if (typeof value !== "object" || value === null) return 0;
  return Object.keys(value).filter((key) => !knownKeys.includes(key)).length;
}

/** Normaliza un nombre para comparar duplicados: minúsculas, sin espacios repetidos. */
export function normalizeNameForDedup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface EntryListStats {
  deduped: number;
  trimmedList: boolean;
}

/**
 * Deduplica por `nameOf` (mismo nombre, sin distinguir mayúsculas/espacios,
 * conservando el orden de aparición, y recorta a `maxItems`.
 */
export function dedupeAndTrimEntries<T>(entries: T[], nameOf: (entry: T) => string, maxItems: number): { entries: T[]; stats: EntryListStats } {
  const seen = new Set<string>();
  const deduped: T[] = [];
  let dedupedCount = 0;

  for (const entry of entries) {
    const key = normalizeNameForDedup(nameOf(entry));
    if (seen.has(key)) {
      dedupedCount += 1;
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  const trimmedList = deduped.length > maxItems;
  if (trimmedList) deduped.length = maxItems;

  return { entries: deduped, stats: { deduped: dedupedCount, trimmedList } };
}
