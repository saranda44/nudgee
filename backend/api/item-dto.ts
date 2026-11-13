/**
 * Recurso público `Item` (Contratos §2.3): única representación de un ítem en listado,
 * detalle y respuestas de acciones. Lista blanca de campos: nunca expone PK, SK, GSI1*,
 * entityType, userId, aiOriginal ni correlationId (Modelo D-10).
 */

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

type Item = Record<string, unknown>;

/** Categorías que permiten checklist (E-18). */
export const CHECKLISTABLE_CATEGORIES = ["RECIPE", "ROUTINE", "TUTORIAL", "MOVIE_SERIES", "PLACE", "BOOK", "MUSIC", "PODCAST"];

/** IDs de los elementos/entradas de las listas de `details` (API-15). */
export function getChecklistIds(item: Item): Set<string> {
  const ids = new Set<string>();
  const details = item.details as Record<string, unknown> | null | undefined;
  if (!details) return ids;
  for (const value of Object.values(details)) {
    if (!Array.isArray(value)) continue;
    for (const el of value) {
      if (el && typeof el === "object" && "id" in el) ids.add(String(el.id));
    }
  }
  return ids;
}

/** `suggestDone`: todas las entradas de la lista marcadas (US-46, API-16). */
export function calculateSuggestDone(checklist: Record<string, unknown>, ids: Set<string>): boolean {
  if (ids.size === 0) return false;
  for (const id of ids) {
    if (checklist[id] !== true) return false;
  }
  return true;
}

const PUBLIC_FIELDS = [
  "videoId",
  "sourceUrl",
  "thumbnailUrl",
  "status",
  "category",
  "title",
  "summary",
  "details",
  "confidence",
  "dataSource",
  "analysisSource",
  "analysisError",
  "savedAt",
  "readyAt",
  "statusUpdatedAt",
  "snoozeUntil",
  "scheduledFor",
  "lastNotifiedAt",
  "expiresAt",
  "version",
] as const;

export function toItemDto(item: Item): Record<string, unknown> {
  const dto: Record<string, unknown> = {};
  for (const field of PUBLIC_FIELDS) dto[field] = item[field] ?? null;

  const checklist = (item.checklist as Record<string, unknown> | undefined) ?? {};
  const snoozeCount = typeof item.snoozeCount === "number" ? item.snoozeCount : 0;
  const listable = CHECKLISTABLE_CATEGORIES.includes(String(item.category));

  dto.checklist = checklist;
  dto.snoozeCount = snoozeCount;
  dto.notifyCount = typeof item.notifyCount === "number" ? item.notifyCount : 0;
  dto.suggestDiscard = snoozeCount >= 3;
  dto.suggestDone = listable && calculateSuggestDone(checklist, getChecklistIds(item));
  return dto;
}

/** Respuesta 200 con el ítem público y su `ETag` (API-02). */
export function itemResponse(item: Item): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ETag: `"${item.version}"` },
    body: JSON.stringify(toItemDto(item)),
  };
}
