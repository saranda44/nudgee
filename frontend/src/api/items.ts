/** E-02, E-05, E-06, E-07, E-15 (Contratos §4–§6). */

import type { ClientConfig, Item } from "../domain/item.ts";
import { api } from "./client.ts";

let configCache: Promise<ClientConfig> | null = null;

/** E-02: cambia muy poco (Cache-Control 1 h); una vez por carga de la app. */
export function getClientConfig(): Promise<ClientConfig> {
  configCache ??= api<ClientConfig>("/v1/config").then((r) => r.data);
  configCache.catch(() => (configCache = null));
  return configCache;
}

interface ItemPage {
  items: Item[];
  nextCursor: string | null;
}

/** E-06 modo listado: todas las páginas (el cliente ordena, filtra y busca, API-12). */
export async function listAllItems(signal?: AbortSignal): Promise<Item[]> {
  const all: Item[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const { data }: { data: ItemPage } = await api<ItemPage>(`/v1/items?${query}`, { signal });
    all.push(...data.items);
    cursor = data.nextCursor;
  } while (cursor);
  return all;
}

/** E-06 modo polling: hasta 25 ids por llamada; los que no existen no aparecen. */
export async function pollItems(videoIds: string[], signal?: AbortSignal): Promise<Item[]> {
  const items: Item[] = [];
  for (let i = 0; i < videoIds.length; i += 25) {
    const ids = videoIds.slice(i, i + 25).join(",");
    items.push(...(await api<ItemPage>(`/v1/items?ids=${encodeURIComponent(ids)}`, { signal })).data.items);
  }
  return items;
}

/** E-05: 202 con el ítem en PROCESSING. */
export async function saveLink(url: string): Promise<Item> {
  return (await api<Item>("/v1/items", { method: "POST", body: { url } })).data;
}

/** E-07 */
export async function getItem(videoId: string, signal?: AbortSignal): Promise<Item> {
  return (await api<Item>(`/v1/items/${encodeURIComponent(videoId)}`, { signal })).data;
}

/** E-15: DISCARDED → PENDING | NEEDS_INPUT. */
export const restoreItem = (videoId: string, version: number) => runAction(videoId, "restore", version);

/** Acciones de estado E-10…E-16 (todas con If-Match y responden el Item con su nueva versión). */
export type ItemAction = "done" | "undo-done" | "snooze" | "reschedule" | "discard" | "restore" | "reactivate";

export async function runAction(videoId: string, action: ItemAction, version: number, body?: unknown): Promise<Item> {
  return (
    await api<Item>(`/v1/items/${encodeURIComponent(videoId)}/${action}`, { method: "POST", ifMatch: version, body })
  ).data;
}

/** E-17: solo desde DISCARDED (204). */
export async function deleteItem(videoId: string, version: number): Promise<void> {
  await api(`/v1/items/${encodeURIComponent(videoId)}`, { method: "DELETE", ifMatch: version });
}

/** E-18: merge de marcas; sin If-Match ni cambio de versión (D-03). */
export async function patchChecklist(
  videoId: string,
  marks: Record<string, boolean>,
): Promise<{ checklist: Record<string, boolean>; suggestDone: boolean }> {
  return (await api<{ checklist: Record<string, boolean>; suggestDone: boolean }>(
    `/v1/items/${encodeURIComponent(videoId)}/checklist`,
    { method: "PATCH", body: marks },
  )).data;
}

/** E-19: apertura desde un recordatorio; idempotente. 404 es silencioso (Diseño UX §2). */
export async function openNotification(slotKey: string): Promise<void> {
  await api(`/v1/notifications/${encodeURIComponent(slotKey)}/open`, { method: "POST" }).catch(() => undefined);
}
