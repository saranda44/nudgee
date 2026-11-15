/**
 * Contador de recordatorios sin leer, compartido por el bottom nav (US-52) y P-06.
 * No guarda la lista completa (eso lo maneja RemindersPage): solo el número.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getUnreadCount } from "../api/notifications.ts";
import { onPushReceived } from "../domain/push.ts";

interface NotificationsState {
  unreadCount: number;
  /** Vuelve a pedir el contador real a la API. */
  refresh: () => void;
  /** Resta de inmediato (ya se marcó leída en el servidor); refresh() corrige si hace falta. */
  markRead: () => void;
  /** P-06 ya trae el número real en su propia primera página (E-22): evita pedirlo otra vez. */
  setUnreadCount: (n: number) => void;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications fuera de NotificationsProvider");
  return ctx;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    getUnreadCount(ctrl.signal).then(setUnreadCount, (e: unknown) => {
      if ((e as Error).name !== "AbortError") setUnreadCount(0);
    });
    return () => ctrl.abort();
  }, [loadKey]);

  const refresh = useCallback(() => setLoadKey((k) => k + 1), []);
  const markRead = useCallback(() => setUnreadCount((n) => Math.max(0, n - 1)), []);

  useEffect(() => onPushReceived(refresh), [refresh]);

  return (
    <NotificationsContext.Provider value={{ unreadCount, refresh, markRead, setUnreadCount }}>{children}</NotificationsContext.Provider>
  );
}
