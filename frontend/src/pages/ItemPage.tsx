/**
 * P-03 Tarjeta del ítem (US-15–US-30, US-38, US-43–US-50). Acciones según RF §4.4, overlays
 * O-01/O-02/O-03, sugerencias en línea (US-21, US-46, US-49) y errores de Diseño UX §2.
 * Con `?slot=` (push o bandeja) registra la apertura (E-19) antes de leer el ítem (E-07).
 */

import { ArrowLeft, YoutubeLogo } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { deleteItem, getItem, openNotification, patchChecklist, runAction, type ItemAction } from "../api/items.ts";
import { Dialog } from "../components/Dialog.tsx";
import { ItemDetails } from "../components/ItemDetails.tsx";
import { Thumbnail } from "../components/Thumbnail.tsx";
import { useToast } from "../components/Toast.tsx";
import { CATEGORY_VIEW } from "../domain/categories.ts";
import { daysUntil, relativeTime } from "../domain/format.ts";
import type { Item } from "../domain/item.ts";
import { youtubeShort } from "../domain/links.ts";
import { errorMessage, t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/es-MX.ts";
import { useLibrary } from "../state/library.tsx";
import { NotFoundPage } from "./placeholders.tsx";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** "Hoy" local en YYYY-MM-DD (la API valida con USER.timezone, que es la misma del navegador). */
function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const formatDay = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

export function ItemPage() {
  const { videoId = "" } = useParams();
  const [params] = useSearchParams();
  const slot = params.get("slot");
  const library = useLibrary();
  const toast = useToast();
  const navigate = useNavigate();
  const item = library.get(videoId);

  const [load, setLoad] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<null | "snooze" | "reschedule" | "delete">(null);
  const [date, setDate] = useState(localDate(1));
  const [dateError, setDateError] = useState<string | null>(null);
  const { upsert, patch, remove } = library;

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!VIDEO_ID.test(videoId)) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        if (slot) await openNotification(slot); // NTF-03: abrir cuenta como respuesta
        upsert(await getItem(videoId, ctrl.signal));
        setLoad("ready");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (e instanceof ApiError && e.status === 404) {
          remove(videoId);
          setLoad("notfound");
        } else {
          setLoadError(errorMessage(e));
          setLoad("error");
        }
      }
    })();
    return () => ctrl.abort();
  }, [videoId, slot, reloadKey, upsert, remove]);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && (e.code === "INVALID_STATE_TRANSITION" || e.code === "VERSION_MISMATCH")) {
        toast({ message: errorMessage(e) });
        reload(); // la tarjeta se recarga con el estado real
      } else if (e instanceof ApiError && e.status === 404) {
        remove(videoId);
        setLoad("notfound");
      } else {
        toast({ message: errorMessage(e) });
      }
    },
    [toast, reload, remove, videoId],
  );

  if (!VIDEO_ID.test(videoId)) return <NotFoundPage />;

  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"));
  const header = (
    <div className="app-header">
      <button type="button" className="app-iconbtn" onClick={goBack} aria-label={t("common.back")}>
        <ArrowLeft size={22} weight="bold" aria-hidden />
      </button>
    </div>
  );

  if (load === "notfound") {
    return (
      <main className="app-page">
        {header}
        <div className="app-empty">
          <p className="t-body">{t("error.ITEM_NOT_FOUND")}</p>
          <Link to="/" className="ng-btn ng-btn--primary">
            {t("notFound.cta")}
          </Link>
        </div>
      </main>
    );
  }
  if (!item) {
    return (
      <main className="app-page" aria-busy={load === "loading"}>
        {header}
        {load === "error" ? (
          <div className="app-empty" role="alert">
            <p className="t-body">{loadError}</p>
            <button type="button" className="ng-btn ng-btn--ghost" onClick={reload}>
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <div className="ng-card is-processing app-hero-card">
            <div className="ng-thumb" />
            <div className="ng-skel app-skel-90" />
            <div className="ng-skel app-skel-55" />
          </div>
        )}
      </main>
    );
  }

  const view = CATEGORY_VIEW[item.category ?? "OTHER"];
  const doneLabel = t(`done.${item.category ?? "OTHER"}`);

  const act = async (action: ItemAction, body?: unknown, after?: (updated: Item) => void) => {
    setBusy(action);
    try {
      const updated = await runAction(item.videoId, action, item.version, body);
      upsert(updated);
      after?.(updated);
      return true;
    } catch (e) {
      onError(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const undoWith = (action: ItemAction) => (updated: Item) => () =>
    runAction(updated.videoId, action, updated.version).then(upsert, onError);

  const markDone = () =>
    act("done", undefined, (u) => toast({ message: t("item.doneToast"), action: { label: t("common.undo"), onClick: undoWith("undo-done")(u) } }));
  const discard = () =>
    act("discard", undefined, (u) => toast({ message: t("item.discardedToast"), action: { label: t("common.undo"), onClick: undoWith("restore")(u) } }));

  const snooze = async (amount: number) => {
    const ok = await act("snooze", { days: amount }, (u) => {
      if (u.snoozeUntil) toast({ message: t("item.snoozedToast", { date: formatDateTime(u.snoozeUntil) }) });
    });
    if (ok) setOverlay(null);
  };

  const reschedule = async () => {
    setDateError(null);
    setBusy("reschedule");
    try {
      upsert(await runAction(item.videoId, "reschedule", item.version, { date }));
      setOverlay(null);
      toast({ message: t("item.rescheduledToast", { date: formatDay(date) }) });
    } catch (e) {
      if (e instanceof ApiError && e.code === "VALIDATION_ERROR") setDateError(t("item.rescheduleInvalid"));
      else {
        setOverlay(null);
        onError(e);
      }
    } finally {
      setBusy(null);
    }
  };

  const destroy = async () => {
    setBusy("delete");
    try {
      await deleteItem(item.videoId, item.version);
      remove(item.videoId);
      toast({ message: t("item.deletedToast") });
      navigate("/", { replace: true });
    } catch (e) {
      setOverlay(null);
      onError(e);
    } finally {
      setBusy(null);
    }
  };

  /** E-18 optimista: se marca al instante y solo esa marca se revierte si la API falla. */
  const toggle = (id: string, checked: boolean) => {
    const mark = (value: boolean) => (cur: Item) => ({ checklist: { ...cur.checklist, [id]: value } });
    patch(item.videoId, mark(checked));
    patchChecklist(item.videoId, { [id]: checked }).then(
      (res) => patch(item.videoId, () => ({ checklist: res.checklist, suggestDone: res.suggestDone })),
      (e: unknown) => {
        patch(item.videoId, mark(!checked));
        onError(e);
      },
    );
  };

  const snoozeLabel = (n: number) =>
    t(library.config?.snoozeUnit === "MINUTE" ? (n === 1 ? "snooze.minute" : "snooze.minutes") : n === 1 ? "snooze.day" : "snooze.days", { n });

  const eventDate = item.category === "EVENT" && typeof item.details?.eventDate === "string" ? item.details.eventDate : null;
  const eventPassed = eventDate !== null && eventDate < localDate();

  let statusNote: string | null = null;
  if (item.status === "PENDING" && item.scheduledFor) statusNote = t("item.scheduledFor", { date: formatDay(item.scheduledFor) });
  else if (item.status === "PENDING" && item.snoozeUntil && new Date(item.snoozeUntil) > new Date())
    statusNote = t("item.snoozedUntil", { date: formatDateTime(item.snoozeUntil) });
  else if (item.status === "DORMANT") statusNote = t("item.dormantNote");
  else if (item.status === "DONE") statusNote = t("item.doneNote", { when: relativeTime(item.statusUpdatedAt ?? item.savedAt) });
  else if (item.status === "DISCARDED" && item.expiresAt) statusNote = t("item.deletesIn", { days: daysUntil(item.expiresAt) });
  else if (item.status === "NEEDS_INPUT") statusNote = t("item.needsInputNote");

  const btn = (key: string, label: string, onClick: () => void, variant: "primary" | "secondary" | "ghost" | "danger") => (
    <button key={key} type="button" className={`ng-btn ng-btn--${variant}`} onClick={onClick} aria-busy={busy === key}>
      {label}
    </button>
  );

  const actions: Record<Item["status"], ReactNode[]> = {
    PROCESSING: [],
    NEEDS_INPUT: [
      <Link key="form" to={`/items/${item.videoId}/edit`} className="ng-btn ng-btn--primary">
        {t("item.fillForm")}
      </Link>,
      btn("discard", t("item.discard"), discard, "danger"),
    ],
    PENDING: [
      btn("done", doneLabel, markDone, "secondary"),
      btn("snooze", t("item.snooze"), () => setOverlay("snooze"), "ghost"),
      btn("reschedule", t("item.reschedule"), () => {
        setDate(localDate(1));
        setDateError(null);
        setOverlay("reschedule");
      }, "ghost"),
      <Link key="edit" to={`/items/${item.videoId}/edit`} className="ng-btn ng-btn--ghost">
        {t("item.edit")}
      </Link>,
      btn("discard", t("item.discard"), discard, "danger"),
    ],
    DORMANT: [
      btn("reactivate", t("item.reactivate"), () => void act("reactivate"), "secondary"),
      <Link key="edit" to={`/items/${item.videoId}/edit`} className="ng-btn ng-btn--ghost">
        {t("item.edit")}
      </Link>,
      btn("discard", t("item.discard"), discard, "danger"),
    ],
    DONE: [btn("undo-done", t("item.undoDone"), () => void act("undo-done"), "ghost")],
    DISCARDED: [
      btn("restore", t("item.restore"), () => void act("restore"), "secondary"),
      btn("delete", t("item.delete"), () => setOverlay("delete"), "danger"),
    ],
  };

  const suggestion = (message: MessageKey, cta: ReactNode) => (
    <div className="app-suggestion" role="note">
      <p className="t-body">{t(message)}</p>
      {cta}
    </div>
  );

  return (
    <main className={`app-page ${view.cssClass}`}>
      {header}

      <div className={item.status === "PROCESSING" ? "ng-card is-processing app-hero-card" : "app-hero"}>
        <div className="ng-thumb">
          <Thumbnail src={item.thumbnailUrl} icon={view.icon} />
          {item.status === "PROCESSING" && <span className="ng-badge">{t("item.analyzing")}</span>}
        </div>
      </div>

      <section className="app-section">
        {item.category && (
          <span className="ng-card__meta">
            <span className={`ng-dot ${view.cssClass}`} aria-hidden />
            {t(view.label)}
          </span>
        )}
        <h1 className="t-title">{item.title ?? (item.status === "PROCESSING" ? t("item.analyzing") : t("item.untitled"))}</h1>
        {item.summary && <p className="t-body">{item.summary}</p>}
        {statusNote && <p className="t-caption app-muted">{statusNote}</p>}
      </section>

      {item.status === "PENDING" && item.suggestDiscard && suggestion("item.suggestDiscard", btn("discard", t("item.discard"), discard, "danger"))}
      {item.status === "PENDING" && item.suggestDone && suggestion("item.suggestDone", btn("done", doneLabel, markDone, "secondary"))}
      {item.status === "PENDING" && eventPassed && suggestion("item.eventPassed", btn("done", doneLabel, markDone, "secondary"))}

      {actions[item.status].length > 0 && <div className="app-actions">{actions[item.status]}</div>}

      <ItemDetails item={item} canCheck={item.status === "PENDING" || item.status === "DORMANT"} onToggle={toggle} />

      <a className="app-extlink" href={youtubeShort(item.videoId)} target="_blank" rel="noopener noreferrer">
        <YoutubeLogo size={20} weight="bold" aria-hidden />
        {t("item.openYoutube")}
      </a>

      <Dialog open={overlay === "snooze"} title={t("item.snoozeTitle")} onClose={() => setOverlay(null)}>
        <div className="app-options">
          {(library.config?.snoozeOptions ?? [1, 3, 5]).map((n) => (
            <button key={n} type="button" className="ng-btn ng-btn--ghost ng-btn--block" onClick={() => snooze(n)} aria-busy={busy === "snooze"}>
              {snoozeLabel(n)}
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog open={overlay === "reschedule"} title={t("item.rescheduleTitle")} onClose={() => setOverlay(null)}>
        <label className={dateError ? "ng-field is-invalid" : "ng-field"}>
          <span className="ng-label">{t("item.rescheduleLabel")}</span>
          <input className="ng-input" type="date" value={date} min={localDate()} max={localDate(365)} onChange={(e) => setDate(e.target.value)} aria-invalid={dateError ? true : undefined} />
          {dateError && (
            <span className="ng-help" role="alert">
              {dateError}
            </span>
          )}
        </label>
        <button type="button" className="ng-btn ng-btn--primary ng-btn--block" onClick={reschedule} aria-busy={busy === "reschedule"}>
          {t("item.reschedule")}
        </button>
      </Dialog>

      <Dialog open={overlay === "delete"} title={t("item.deleteTitle")} onClose={() => setOverlay(null)}>
        <p className="t-body">{t("item.deleteBody")}</p>
        <button type="button" className="ng-btn ng-btn--danger ng-btn--block" onClick={destroy} aria-busy={busy === "delete"}>
          {t("item.delete")}
        </button>
        <button type="button" className="ng-btn ng-btn--ghost ng-btn--block" onClick={() => setOverlay(null)}>
          {t("common.cancel")}
        </button>
      </Dialog>
    </main>
  );
}
