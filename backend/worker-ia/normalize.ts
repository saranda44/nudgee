import { CATEGORIES, LIMITS, type AnalysisResult, type Category, type ValidationIssue } from "../schemas/index.ts";
import { validateAnalysis } from "../schemas/validators.ts";
import {
  cleanCheckList,
  cleanSteps,
  cleanText,
  countUnknownKeys,
  dedupeAndTrimEntries,
  type CheckListStats,
  type TextStats,
} from "./normalize-helpers.ts";

export interface IdGenerator {
  nextCheckItemId(): string;
  nextEntryId(): string;
}

/** `n` = máximo actual + 1; en un análisis nuevo no hay ids previos, así que arranca en 1. */
export function createIdGenerator(): IdGenerator {
  let checkItemCount = 0;
  let entryCount = 0;
  return {
    nextCheckItemId: () => `i${++checkItemCount}`,
    nextEntryId: () => `e${++entryCount}`,
  };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function nextLeapYear(fromYear: number): number {
  let year = fromYear;
  while (!isLeapYear(year)) year += 1;
  return year;
}

/**`MM-DD` -> próxima ocurrencia en `YYYY-MM-DD` respecto a `now` (UTC). `02-29` -> próximo año bisiesto. */
export function resolveEventMonthDay(monthDay: string, now: Date): string | undefined {
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const todayYear = now.getUTCFullYear();
  const targetKey = month * 100 + day;
  const todayKey = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();

  let year: number;
  if (month === 2 && day === 29) {
    year = isLeapYear(todayYear) && todayKey <= targetKey ? todayYear : nextLeapYear(todayYear + 1);
  } else {
    year = todayKey <= targetKey ? todayYear : todayYear + 1;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface NormalizationStats {
  /** Campos fuera del schema, descartados. */
  discardedFields: number;
  truncatedTexts: number;
  droppedEmptyFields: number;
  dedupedEntries: number;
  trimmedLists: number;
}

function emptyStats(): NormalizationStats {
  return { discardedFields: 0, truncatedTexts: 0, droppedEmptyFields: 0, dedupedEntries: 0, trimmedLists: 0 };
}

function mergeCheckListStats(stats: NormalizationStats, sub: CheckListStats): void {
  stats.truncatedTexts += sub.truncated;
  stats.droppedEmptyFields += sub.droppedEmpty + sub.droppedItems;
  if (sub.trimmedList) stats.trimmedLists += 1;
}

function mergeTextStats(stats: NormalizationStats, sub: TextStats): void {
  stats.truncatedTexts += sub.truncated;
  stats.droppedEmptyFields += sub.droppedEmpty;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function cleanPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function cleanYear(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= LIMITS.year.minimum && value <= LIMITS.year.maximum ? value : undefined;
}

function cleanEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// --- Categorías con elementos marcables (RECIPE, ROUTINE, TUTORIAL) ---

function cleanRecipeDetails(raw: unknown, ids: IdGenerator, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["ingredients", "steps", "prepTime"]);

  const ingredientList = cleanCheckList(d.ingredients, { maxTextLength: LIMITS.checkItem.maxLength, maxItems: LIMITS.checkItem.maxItems });
  mergeCheckListStats(stats, ingredientList.stats);
  const ingredients = ingredientList.items.map((item) => ({ id: ids.nextCheckItemId(), ...item }));

  const stepList = cleanSteps(d.steps, { maxTextLength: LIMITS.steps.maxLength, maxItems: LIMITS.steps.maxItems });
  mergeCheckListStats(stats, stepList.stats);

  const prepTime = cleanPositiveInteger(d.prepTime);

  return {
    ingredients,
    ...(stepList.steps.length > 0 ? { steps: stepList.steps } : {}),
    ...(prepTime !== undefined ? { prepTime } : {}),
  };
}

function cleanRoutineDetails(raw: unknown, ids: IdGenerator, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["exercises", "durationMin"]);

  const exerciseList = cleanCheckList(d.exercises, { maxTextLength: LIMITS.checkItem.maxLength, maxItems: LIMITS.checkItem.maxItems });
  mergeCheckListStats(stats, exerciseList.stats);
  const exercises = exerciseList.items.map((item) => ({ id: ids.nextCheckItemId(), ...item }));

  const durationMin = cleanPositiveInteger(d.durationMin);

  return { exercises, ...(durationMin !== undefined ? { durationMin } : {}) };
}

function cleanTutorialDetails(raw: unknown, ids: IdGenerator, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["materials", "steps"]);

  const materialList = cleanCheckList(d.materials, { maxTextLength: LIMITS.checkItem.maxLength, maxItems: LIMITS.checkItem.maxItems });
  mergeCheckListStats(stats, materialList.stats);
  const materials = materialList.items.map((item) => ({ id: ids.nextCheckItemId(), ...item }));

  const stepList = cleanSteps(d.steps, { maxTextLength: LIMITS.steps.maxLength, maxItems: LIMITS.steps.maxItems });
  mergeCheckListStats(stats, stepList.stats);

  // La regla "al menos materials o steps" no se fuerza aquí: si ambos
  // quedan vacíos, la validación final contra la vista stored lo rechaza (INVALID_OUTPUT).
  return {
    ...(materials.length > 0 ? { materials } : {}),
    ...(stepList.steps.length > 0 ? { steps: stepList.steps } : {}),
  };
}

// --- EVENT ---

function cleanEventDetails(raw: unknown, now: Date, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["name", "eventDate", "eventTime", "cityOrAddress", "eventMonthDay"]);

  const textStats: TextStats = { truncated: 0, droppedEmpty: 0 };
  const name = cleanText(d.name, LIMITS.entryText.maxLength, textStats) ?? "";
  const cityOrAddress = cleanText(d.cityOrAddress, LIMITS.entryText.maxLength, textStats);
  mergeTextStats(stats, textStats);

  const eventTime = typeof d.eventTime === "string" && /^\d{2}:\d{2}$/.test(d.eventTime) ? d.eventTime : undefined;

  // eventMonthDay (solo vista ai) siempre se descarta tras resolverla; si ya
  // viene eventDate completo, se prefiere ese y no se necesita resolver nada.
  let eventDate: string | undefined;
  if (typeof d.eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.eventDate)) {
    eventDate = d.eventDate;
  } else if (typeof d.eventMonthDay === "string") {
    eventDate = resolveEventMonthDay(d.eventMonthDay, now);
  }

  return {
    name,
    ...(eventDate !== undefined ? { eventDate } : {}),
    ...(eventTime !== undefined ? { eventTime } : {}),
    ...(cityOrAddress !== undefined ? { cityOrAddress } : {}),
  };
}

// --- Categorías de lista (entries) ---

function cleanListEntries<T extends { }>(
  rawEntries: unknown,
  mapEntry: (raw: Record<string, unknown>, textStats: TextStats) => (T & { id?: never }) | undefined,
  nameOf: (entry: T) => string,
  stats: NormalizationStats,
): T[] {
  const textStats: TextStats = { truncated: 0, droppedEmpty: 0 };
  const list = Array.isArray(rawEntries) ? rawEntries : [];

  const cleaned = list
    .map((raw) => mapEntry(asRecord(raw), textStats))
    .filter((entry): entry is T => entry !== undefined);

  mergeTextStats(stats, textStats);

  const { entries, stats: entryStats } = dedupeAndTrimEntries(cleaned, nameOf, LIMITS.entries.maxItems);
  stats.dedupedEntries += entryStats.deduped;
  if (entryStats.trimmedList) stats.trimmedLists += 1;
  return entries;
}

function cleanMovieSeriesDetails(raw: unknown, ids: IdGenerator, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["entries"]);

  const entries = cleanListEntries(
    d.entries,
    (e, textStats) => {
      const title = cleanText(e.title, LIMITS.entryText.maxLength, textStats);
      if (title === undefined) return undefined;
      const mediaType = cleanEnum(e.mediaType, ["MOVIE", "SERIES"] as const, "MOVIE"); // SCH-11
      const year = cleanYear(e.year);
      return { title, mediaType, ...(year !== undefined ? { year } : {}) };
    },
    (e) => e.title,
    stats,
  );

  return { entries: entries.map((e) => ({ id: ids.nextEntryId(), ...e })) };
}

function cleanPlaceDetails(raw: unknown, ids: IdGenerator, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["entries"]);

  const entries = cleanListEntries(
    d.entries,
    (e, textStats) => {
      const name = cleanText(e.name, LIMITS.entryText.maxLength, textStats);
      if (name === undefined) return undefined;
      const cityOrAddress = cleanText(e.cityOrAddress, LIMITS.entryText.maxLength, textStats);
      return { name, ...(cityOrAddress !== undefined ? { cityOrAddress } : {}) };
    },
    (e) => e.name,
    stats,
  );

  return { entries: entries.map((e) => ({ id: ids.nextEntryId(), ...e })) };
}

function cleanBookDetails(raw: unknown, ids: IdGenerator, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["entries"]);

  const entries = cleanListEntries(
    d.entries,
    (e, textStats) => {
      const title = cleanText(e.title, LIMITS.entryText.maxLength, textStats);
      if (title === undefined) return undefined;
      const author = cleanText(e.author, LIMITS.entryText.maxLength, textStats);
      return { title, ...(author !== undefined ? { author } : {}) };
    },
    (e) => e.title,
    stats,
  );

  return { entries: entries.map((e) => ({ id: ids.nextEntryId(), ...e })) };
}

function cleanMusicDetails(raw: unknown, ids: IdGenerator, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["entries"]);

  const entries = cleanListEntries(
    d.entries,
    (e, textStats) => {
      const name = cleanText(e.name, LIMITS.entryText.maxLength, textStats);
      if (name === undefined) return undefined;
      const musicType = cleanEnum(e.musicType, ["SONG", "ALBUM", "ARTIST"] as const, "SONG"); // SCH-11
      const artist = cleanText(e.artist, LIMITS.entryText.maxLength, textStats);
      const genre = cleanText(e.genre, LIMITS.entryText.maxLength, textStats);
      return { name, musicType, ...(artist !== undefined ? { artist } : {}), ...(genre !== undefined ? { genre } : {}) };
    },
    (e) => e.name,
    stats,
  );

  return { entries: entries.map((e) => ({ id: ids.nextEntryId(), ...e })) };
}

function cleanPodcastDetails(raw: unknown, ids: IdGenerator, stats: NormalizationStats): Record<string, unknown> {
  const d = asRecord(raw);
  stats.discardedFields += countUnknownKeys(d, ["entries"]);

  const entries = cleanListEntries(
    d.entries,
    (e, textStats) => {
      const showName = cleanText(e.showName, LIMITS.entryText.maxLength, textStats);
      if (showName === undefined) return undefined;
      const episode = cleanText(e.episode, LIMITS.entryText.maxLength, textStats);
      return { showName, ...(episode !== undefined ? { episode } : {}) };
    },
    (e) => e.showName,
    stats,
  );

  return { entries: entries.map((e) => ({ id: ids.nextEntryId(), ...e })) };
}

function cleanDetailsForCategory(
  category: Category,
  rawDetails: unknown,
  now: Date,
  ids: IdGenerator,
  stats: NormalizationStats,
): Record<string, unknown> | undefined {
  switch (category) {
    case "RECIPE":
      return cleanRecipeDetails(rawDetails, ids, stats);
    case "ROUTINE":
      return cleanRoutineDetails(rawDetails, ids, stats);
    case "TUTORIAL":
      return cleanTutorialDetails(rawDetails, ids, stats);
    case "EVENT":
      return cleanEventDetails(rawDetails, now, stats);
    case "OTHER":
      return undefined; 
    case "MOVIE_SERIES":
      return cleanMovieSeriesDetails(rawDetails, ids, stats);
    case "PLACE":
      return cleanPlaceDetails(rawDetails, ids, stats);
    case "BOOK":
      return cleanBookDetails(rawDetails, ids, stats);
    case "MUSIC":
      return cleanMusicDetails(rawDetails, ids, stats);
    case "PODCAST":
      return cleanPodcastDetails(rawDetails, ids, stats);
  }
}

export type NormalizeResult =
  | { kind: "OK"; analysis: AnalysisResult; confidence: number; stats: NormalizationStats }
  | { kind: "CANNOT_ANALYZE"; reason: "NO_ACCESS" | "PROCESSING_FAILED" }
  | { kind: "INVALID_OUTPUT"; errors: ValidationIssue[] };

/**
 * Pipeline de normalización de Schemas, pasos 1-9 (el 10, guardar, es del
 * worker). Pura y determinista: mismo texto + mismo reloj + mismo
 * generador de ids, mismo resultado.
 */
export function normalizeAiOutput(rawText: string, now: Date, ids: IdGenerator): NormalizeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { kind: "INVALID_OUTPUT", errors: [{ pointer: "/", code: "INVALID_JSON", message: "Gemini output is not valid JSON" }] };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "INVALID_OUTPUT", errors: [{ pointer: "/", code: "INVALID_TYPE", message: "Gemini output is not an object" }] };
  }
  const envelope = parsed as Record<string, unknown>;

  if (envelope.outcome === "CANNOT_ANALYZE") {
    // el reason solo alimenta logs/métricas, ambos valores llevan al mismo estado.
    const reason = envelope.reason === "NO_ACCESS" ? "NO_ACCESS" : "PROCESSING_FAILED";
    return { kind: "CANNOT_ANALYZE", reason };
  }

  if (envelope.outcome !== "OK") {
    return { kind: "INVALID_OUTPUT", errors: [{ pointer: "/outcome", code: "ENUM", message: "outcome must be OK or CANNOT_ANALYZE" }] };
  }

  const rawAnalysis = envelope.analysis;
  if (typeof rawAnalysis !== "object" || rawAnalysis === null) {
    return { kind: "INVALID_OUTPUT", errors: [{ pointer: "/analysis", code: "REQUIRED", message: "analysis is required when outcome is OK" }] };
  }
  const analysisObj = rawAnalysis as Record<string, unknown>;

  const category = analysisObj.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category as Category)) {
    return { kind: "INVALID_OUTPUT", errors: [{ pointer: "/analysis/category", code: "ENUM", message: "unknown category" }] };
  }

  if (typeof envelope.confidence !== "number" || !Number.isFinite(envelope.confidence) || envelope.confidence < 0 || envelope.confidence > 1) {
    return { kind: "INVALID_OUTPUT", errors: [{ pointer: "/confidence", code: "REQUIRED", message: "confidence must be a number between 0 and 1" }] };
  }

  const stats = emptyStats();
  stats.discardedFields += countUnknownKeys(analysisObj, ["category", "title", "summary", "details"]);

  const textStats: TextStats = { truncated: 0, droppedEmpty: 0 };
  const title = cleanText(analysisObj.title, LIMITS.title.maxLength, textStats) ?? "";
  const summary = cleanText(analysisObj.summary, LIMITS.summary.maxLength, textStats);
  mergeTextStats(stats, textStats);

  const details = cleanDetailsForCategory(category as Category, analysisObj.details, now, ids, stats);

  const cleanedAnalysis: Record<string, unknown> = {
    category,
    title,
    ...(summary !== undefined ? { summary } : {}),
    ...(details !== undefined ? { details } : {}),
  };

  // Paso 9: única fuente de verdad sobre si el resultado ya es válido (incluye
  // la regla de TUTORIAL, que no se fuerza a mano arriba).
  const { valid, errors } = validateAnalysis("stored", cleanedAnalysis);
  if (!valid) {
    return { kind: "INVALID_OUTPUT", errors: errors ?? [] };
  }

  return { kind: "OK", analysis: cleanedAnalysis as AnalysisResult, confidence: envelope.confidence, stats };
}
