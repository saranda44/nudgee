/** Recurso `Item` tal como lo devuelve la API (backend/api/item-dto.ts, Contratos §2.3). */

export const CATEGORIES = [
  "RECIPE",
  "ROUTINE",
  "TUTORIAL",
  "MOVIE_SERIES",
  "PLACE",
  "BOOK",
  "MUSIC",
  "PODCAST",
  "EVENT",
  "OTHER",
] as const; // orden fijo de RF §3.1 (UX-10)

export type Category = (typeof CATEGORIES)[number];

export type ItemStatus = "PROCESSING" | "NEEDS_INPUT" | "PENDING" | "DORMANT" | "DONE" | "DISCARDED";

export interface Item {
  videoId: string;
  sourceUrl: string;
  thumbnailUrl: string | null;
  status: ItemStatus;
  category: Category | null;
  title: string | null;
  summary: string | null;
  details: Record<string, unknown> | null;
  checklist: Record<string, boolean>;
  confidence: number | null;
  dataSource: "AI" | "USER" | null;
  analysisSource: "GEMINI" | "CACHE" | null;
  analysisError: string | null;
  savedAt: string;
  readyAt: string | null;
  statusUpdatedAt: string | null;
  snoozeUntil: string | null;
  scheduledFor: string | null;
  snoozeCount: number;
  suggestDiscard: boolean;
  suggestDone: boolean;
  notifyCount: number;
  lastNotifiedAt: string | null;
  expiresAt: string | null;
  version: number;
}

/** E-02 (API-10). */
export interface ClientConfig {
  vapidPublicKey: string;
  reminderSlots: string[];
  snoozeOptions: number[];
  snoozeUnit: "DAY" | "MINUTE";
  discardRetentionDays: number;
  pollingIntervalMs: number;
  pollingMaxDurationMs: number;
}

/** Entradas de una lista (MOVIE_SERIES, PLACE, BOOK, MUSIC, PODCAST): `details.entries[]`. */
export function listEntries(item: Item): Array<{ id: string }> {
  const entries = item.details?.entries;
  return Array.isArray(entries) ? (entries as Array<{ id: string }>) : [];
}
