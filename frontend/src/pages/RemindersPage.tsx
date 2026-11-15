/** P-06 Bandeja de recordatorios (US-51, E-22; E-19 ya lo dispara ItemPage vía ?slot=). */

import { useCallback, useEffect, useState } from "react";
import { listNotifications, type Notification } from "../api/notifications.ts";
import { ReminderRow } from "../components/ReminderRow.tsx";
import { dayBucket } from "../domain/format.ts";
import { onPushReceived } from "../domain/push.ts";
import type { MessageKey } from "../i18n/es-MX.ts";
import { errorMessage, t } from "../i18n/index.ts";
import { useLibrary } from "../state/library.tsx";
import { useNotifications } from "../state/notifications.tsx";

type GroupKey = "today" | "yesterday" | "week" | "earlier";
const GROUPS: Array<{ key: GroupKey; label: MessageKey }> = [
  { key: "today", label: "reminders.today" },
  { key: "yesterday", label: "reminders.yesterday" },
  { key: "week", label: "reminders.thisWeek" },
  { key: "earlier", label: "reminders.earlier" },
];

function groupNotifications(list: Notification[]) {
  const buckets = new Map<GroupKey, Notification[]>();
  for (const n of list) {
    const key = dayBucket(n.sentAt);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(n);
    else buckets.set(key, [n]);
  }
  return GROUPS.map((g) => ({ ...g, items: buckets.get(g.key) ?? [] })).filter((g) => g.items.length > 0);
}

export function RemindersPage() {
  const library = useLibrary();
  const { unreadCount, markRead, setUnreadCount } = useNotifications();
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (after: string | null, signal?: AbortSignal) => {
      const page = await listNotifications(after, signal);
      setItems((prev) => (after ? [...prev, ...page.notifications] : page.notifications));
      setCursor(page.nextCursor);
      if (page.unreadCount !== undefined) setUnreadCount(page.unreadCount);
      return page;
    },
    [setUnreadCount],
  );

  const loadFirst = useCallback(
    (signal?: AbortSignal) => {
      setLoad("loading");
      fetchPage(null, signal).then(
        () => setLoad("ready"),
        (e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setLoadError(errorMessage(e));
          setLoad("error");
        },
      );
    },
    [fetchPage],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    loadFirst(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // US-35: si llega un push mientras la bandeja ya está abierta, se refresca sola (sin esto,
  // solo se actualizaba al recargar la página).
  useEffect(() => onPushReceived(() => loadFirst()), [loadFirst]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchPage(cursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const markLocalRead = (slotKey: string) => {
    setItems((prev) => prev.map((n) => (n.slotKey === slotKey && !n.openedAt ? { ...n, openedAt: new Date().toISOString() } : n)));
    markRead();
  };

  const groups = groupNotifications(items);

  return (
    <main className="app-page app-page--with-nav">
      <h1 className="t-display">{t("reminders.title")}</h1>
      {unreadCount > 0 && <p className="t-body app-muted">{t("nav.unread", { count: unreadCount })}</p>}

      {load === "loading" && items.length === 0 && (
        <div className="ng-inbox" aria-busy="true" aria-label={t("common.loading")}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="ng-reminder">
              <span className="ng-skel app-skel-90" />
            </div>
          ))}
        </div>
      )}

      {load === "error" && items.length === 0 && (
        <div className="app-empty" role="alert">
          <p className="t-body">{loadError}</p>
          <button type="button" className="ng-btn ng-btn--ghost" onClick={() => loadFirst()}>
            {t("common.retry")}
          </button>
        </div>
      )}

      {load === "ready" && items.length === 0 && (
        <div className="app-empty">
          <p className="t-body app-muted">{t("reminders.empty")}</p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="ng-col">
          {groups.map((g) => (
            <section key={g.key} className="app-section">
              <h2 className="app-day-group">{t(g.label)}</h2>
              <div className="ng-inbox">
                {g.items.map((n) => (
                  <ReminderRow
                    key={n.slotKey}
                    notification={n}
                    exists={library.status !== "ready" || Boolean(library.get(n.videoId))}
                    onOpen={() => markLocalRead(n.slotKey)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {cursor && (
        <button type="button" className="ng-btn ng-btn--ghost ng-btn--block" onClick={loadMore} aria-busy={loadingMore}>
          {t("reminders.loadMore")}
        </button>
      )}
    </main>
  );
}
