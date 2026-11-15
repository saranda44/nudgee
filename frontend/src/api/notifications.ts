/** E-19, E-22 (NTF-03, NTF-06, P-06 Bandeja). */

import type { Category } from "../domain/item.ts";
import { api } from "./client.ts";

export interface Notification {
  slotKey: string;
  videoId: string;
  category: Category | null;
  title: string | null;
  messageKey: string;
  messageParams: Record<string, string | number>;
  sentAt: string;
  openedAt: string | null;
}

interface NotificationsPage {
  notifications: Notification[];
  /** Solo en la primera página (sin cursor). */
  unreadCount?: number;
  nextCursor: string | null;
}

/** E-22: una página de la bandeja (20 por página). */
export async function listNotifications(cursor: string | null, signal?: AbortSignal): Promise<NotificationsPage> {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return (await api<NotificationsPage>(`/v1/notifications?${query}`, { signal })).data;
}

/** Primera página, solo para el contador del bottom nav (US-52): limit=1 no reduce el cómputo
 *  de unreadCount en el servidor, pero sí el peso de la respuesta. */
export async function getUnreadCount(signal?: AbortSignal): Promise<number> {
  const { data } = await api<NotificationsPage>("/v1/notifications?limit=1", { signal });
  return data.unreadCount ?? 0;
}
