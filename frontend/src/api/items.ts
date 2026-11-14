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
export async function restoreItem(videoId: string, version: number): Promise<Item> {
  return (await api<Item>(`/v1/items/${encodeURIComponent(videoId)}/restore`, { method: "POST", ifMatch: version })).data;
}
