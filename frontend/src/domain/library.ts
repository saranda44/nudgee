/**
 * Lógica pura de la biblioteca (P-02, P-07): orden, carpetas, filtros y búsqueda en el cliente.
 * E-06 no ordena (API-12): todo se calcula aquí sobre la lista completa.
 */

import { CATEGORIES, type Category, type Item, type ItemStatus } from "./item.ts";

/** Más reciente primero. */
export function sortBySavedAt(items: Item[]): Item[] {
  return [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Franja En proceso (UX-09): sin categoría final todavía. */
export function inProgress(items: Item[]): Item[] {
  return sortBySavedAt(items.filter((i) => i.status === "PROCESSING" || i.status === "NEEDS_INPUT"));
}

/** Ítems que viven en carpetas: con categoría y fuera de la franja. */
function inFolders(items: Item[]): Item[] {
  return items.filter((i) => i.category !== null && i.status !== "PROCESSING" && i.status !== "NEEDS_INPUT");
}

export interface Folder {
  category: Category | "all";
  /** "Por hacer" = PENDING, igual que la vista por defecto de la carpeta (UX-05). */
  pendingCount: number;
  /** Las 3 miniaturas más recientes. */
  thumbnails: string[];
}

function folderOf(category: Category | "all", items: Item[]): Folder {
  const sorted = sortBySavedAt(items);
  return {
    category,
    pendingCount: items.filter((i) => i.status === "PENDING").length,
    thumbnails: sorted.flatMap((i) => (i.thumbnailUrl ? [i.thumbnailUrl] : [])).slice(0, 3),
  };
}

/**
 * "Todo" primero y luego solo las categorías con ítems, en el orden fijo de RF §3.1 (UX-08,
 * UX-10). Sin ítems en carpetas no hay ninguna (estado vacío de P-02).
 */
export function buildFolders(items: Item[]): Folder[] {
  const foldered = inFolders(items);
  if (foldered.length === 0) return [];
  const folders = [folderOf("all", foldered)];
  for (const category of CATEGORIES) {
    const inCategory = foldered.filter((i) => i.category === category);
    if (inCategory.length > 0) folders.push(folderOf(category, inCategory));
  }
  return folders;
}

/** Chips de estado de P-07; "PENDING" es el default (UX-05). */
export const STATUS_FILTERS = ["ALL", "PENDING", "DORMANT", "DONE", "DISCARDED"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function parseStatusFilter(value: string | null): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value ?? "") ? (value as StatusFilter) : "PENDING";
}

export function folderItems(items: Item[], category: Category | "all", status: StatusFilter): Item[] {
  return sortBySavedAt(
    inFolders(items).filter(
      (i) => (category === "all" || i.category === category) && (status === "ALL" || i.status === (status as ItemStatus)),
    ),
  );
}

/** Minúsculas y sin acentos: "Película" encuentra "pelicula". */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** UX-11: busca en todo (cualquier estado) por `title` y `summary`; todas las palabras deben aparecer. */
export function searchItems(items: Item[], query: string): Item[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return sortBySavedAt(
    items.filter((i) => {
      const haystack = normalize(`${i.title ?? ""} ${i.summary ?? ""}`);
      return terms.every((term) => haystack.includes(term));
    }),
  );
}
