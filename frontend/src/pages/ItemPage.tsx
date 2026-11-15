/**
 * P-03 Tarjeta del ítem (US-15–US-30, US-38, US-43–US-50). Acciones según RF §4.4, overlays
 * O-01/O-02/O-03, sugerencias en línea (US-21, US-46, US-49) y errores de Diseño UX §2.
 * Con `?slot=` (push o bandeja) registra la apertura (E-19) antes de leer el ítem (E-07).
 */

import {
  ArrowCounterClockwise,
  ArrowLeft,
  CalendarBlank,
  CheckCircle,
  Clock,
  MoonStars,
  TrashSimple,
  YoutubeLogo,
  type Icon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { deleteItem, getItem, openNotification, patchChecklist, runAction, type ItemAction } from "../api/items.ts";
import { Calendar } from "../components/Calendar.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { ItemDetails, categoryMeta } from "../components/ItemDetails.tsx";
import { Thumbnail } from "../components/Thumbnail.tsx";
import { useToast } from "../components/Toast.tsx";
import { CATEGORY_VIEW } from "../domain/categories.ts";
import { daysUntil, formatShortDate } from "../domain/format.ts";
import type { Item } from "../domain/item.ts";
import { youtubeShort } from "../domain/links.ts";
import { errorMessage, t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/es-MX.ts";
import { useLibrary } from "../state/library.tsx";
import { useNotifications } from "../state/notifications.tsx";
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
  const { refresh: refreshUnread } = useNotifications();
  const toast = useToast();
  const navigate = useNavigate();
  const item = library.get(videoId);

  const [load, setLoad] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<null | "snooze" | "reschedule" | "delete">(null);
  const [snoozeChoice, setSnoozeChoice] = useState(1);
  const [date, setDate] = useState(localDate(1));
  const [dateError, setDateError] = useState<string | null>(null);
  const { upsert, patch, remove } = library;

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!VIDEO_ID.test(videoId)) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        if (slot) {
          await openNotification(slot); // NTF-03: abrir cuenta como respuesta
          refreshUnread(); // no sabemos si ya estaba leída (p. ej. un push viejo); se pide el número real
        }
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
  }, [videoId, slot, reloadKey, upsert, remove, refreshUnread]);

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
  const meta = categoryMeta(item);
  // EVENT: la fecha/hora ya va en `meta`; aquí donde normalmente iría el resumen, es más útil el
  // lugar (si lo hay) que un resumen genérico.
  const eventPlace = item.category === "EVENT" && typeof item.details?.cityOrAddress === "string" ? item.details.cityOrAddress : null;
  const subtitle = item.category === "EVENT" ? eventPlace : item.summary;
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

  /** Vista previa de a qué hora/fecha caería cada opción de posponer (O-02). */
  const snoozePreview = (n: number) => {
    const d = new Date();
    if (library.config?.snoozeUnit === "MINUTE") {
      d.setMinutes(d.getMinutes() + n);
      return d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
    }
    d.setDate(d.getDate() + n);
    return formatShortDate(d);
  };

  const eventDate = item.category === "EVENT" && typeof item.details?.eventDate === "string" ? item.details.eventDate : null;
  const eventPassed = eventDate !== null && eventDate < localDate();

  let statusNote: string | null = null;
  if (item.status === "PENDING" && item.scheduledFor) statusNote = t("item.scheduledFor", { date: formatDay(item.scheduledFor) });
  else if (item.status === "PENDING" && item.snoozeUntil && new Date(item.snoozeUntil) > new Date())
    statusNote = t("item.snoozedUntil", { date: formatDateTime(item.snoozeUntil) });
  else if (item.status === "NEEDS_INPUT") statusNote = t("item.needsInputNote");

  // DISCARDED, DONE y DORMANT tienen su propia tarjeta arriba de todo (con sus acciones ahí
  // mismo), en vez del statusNote genérico.
  const discardDays = item.status === "DISCARDED" && item.expiresAt ? daysUntil(item.expiresAt) : null;
  const doneDate = item.status === "DONE" ? formatShortDate(new Date(item.statusUpdatedAt ?? item.savedAt)) : null;

  const btn = (key: string, label: string, onClick: () => void, variant: "primary" | "secondary" | "ghost" | "danger", icon?: Icon) => {
    const IconCmp = icon;
    return (
      <button key={key} type="button" className={`ng-btn ng-btn--${variant}`} onClick={onClick} aria-busy={busy === key}>
        {IconCmp && <IconCmp size={18} weight="bold" aria-hidden />}
        {label}
      </button>
    );
  };

  const editLink = (
    <Link key="edit" to={`/items/${item.videoId}/edit`} className="ng-btn ng-btn--ghost">
      {t("item.edit")}
    </Link>
  );

  /** `primary`: acción principal, a lo ancho. `secondary`/`tertiary`: filas debajo, Diseño UX. */
  interface ActionGroup {
    primary?: ReactNode;
    secondary?: ReactNode[];
    tertiary?: ReactNode[];
  }

  const actionGroups: Record<Item["status"], ActionGroup> = {
    PROCESSING: {},
    NEEDS_INPUT: {
      primary: (
        <Link key="form" to={`/items/${item.videoId}/edit`} className="ng-btn ng-btn--primary">
          {t("item.fillForm")}
        </Link>
      ),
      tertiary: [btn("discard", t("item.discard"), discard, "danger")],
    },
    PENDING: {
      primary: btn("done", doneLabel, markDone, "secondary"),
      secondary: [
        btn(
          "snooze",
          t("item.snooze"),
          () => {
            setSnoozeChoice((library.config?.snoozeOptions ?? [1, 3, 5])[0]);
            setOverlay("snooze");
          },
          "ghost",
          Clock,
        ),
        btn(
          "reschedule",
          t("item.reschedule"),
          () => {
            setDate(localDate(1));
            setDateError(null);
            setOverlay("reschedule");
          },
          "ghost",
          CalendarBlank,
        ),
      ],
      tertiary: [editLink, btn("discard", t("item.discard"), discard, "danger")],
    },
    // "Reactivar" de DORMANT, "Deshacer" de DONE y Restaurar/Eliminar de DISCARDED viven en su
    // propia tarjeta arriba de la página; DORMANT conserva Editar/Descartar aquí abajo.
    DORMANT: { tertiary: [editLink, btn("discard", t("item.discard"), discard, "danger")] },
    DONE: {},
    DISCARDED: {},
  };

  const group = actionGroups[item.status];
  const hasActions = Boolean(group.primary || group.secondary?.length || group.tertiary?.length);

  const suggestion = (message: MessageKey, cta: ReactNode) => (
    <div className="app-suggestion" role="note">
      <p className="t-body">{t(message)}</p>
      {cta}
    </div>
  );

  return (
    <main className={item.status === "DONE" ? `app-page ${view.cssClass} is-done` : `app-page ${view.cssClass}`}>
      {header}

      {item.status === "DONE" && (
        <div className="app-status-card">
          <div className="app-status-card__header">
            <span className="ng-reminder__icon is-success" aria-hidden>
              <CheckCircle size={20} weight="bold" />
            </span>
            <span className="ng-reminder__text">
              <span className="ng-reminder__msg">{t("item.doneTitle")}</span>
              {doneDate && <span className="ng-reminder__meta">{t("item.doneSubtitle", { date: doneDate })}</span>}
            </span>
          </div>
          <div className="app-status-card__actions">
            <button
              type="button"
              className="ng-btn ng-btn--ghost ng-btn--block"
              onClick={() => void act("undo-done")}
              aria-busy={busy === "undo-done"}
            >
              {t("item.undoDoneShort")}
            </button>
          </div>
        </div>
      )}

      {item.status === "DORMANT" && (
        <div className="app-status-card">
          <div className="app-status-card__header">
            <span className="ng-reminder__icon is-neutral" aria-hidden>
              <MoonStars size={20} weight="bold" />
            </span>
            <span className="ng-reminder__text">
              <span className="ng-reminder__msg">{t("item.dormantTitle")}</span>
              <span className="ng-reminder__meta">{t("item.dormantSubtitle")}</span>
            </span>
          </div>
          <div className="app-status-card__actions">
            <button
              type="button"
              className="ng-btn ng-btn--primary ng-btn--block"
              onClick={() => void act("reactivate")}
              aria-busy={busy === "reactivate"}
            >
              {t("item.reactivate")}
            </button>
          </div>
        </div>
      )}

      {item.status === "DISCARDED" && (
        <div className="app-status-card">
          <div className="app-status-card__header">
            <span className="ng-reminder__icon is-neutral" aria-hidden>
              <Clock size={20} weight="bold" />
            </span>
            <span className="ng-reminder__text">
              <span className="ng-reminder__msg">{t("item.discardedTitle")}</span>
              {discardDays !== null && <span className="ng-reminder__meta">{t("item.discardedSubtitle", { days: discardDays })}</span>}
            </span>
          </div>
          <div className="app-status-card__actions">
            <button type="button" className="ng-btn ng-btn--primary" onClick={() => void act("restore")} aria-busy={busy === "restore"}>
              <ArrowCounterClockwise size={18} weight="bold" aria-hidden />
              {t("item.restore")}
            </button>
            <button type="button" className="ng-btn ng-btn--danger" onClick={() => setOverlay("delete")}>
              <TrashSimple size={18} weight="bold" aria-hidden />
              {t("item.deleteShort")}
            </button>
          </div>
        </div>
      )}

      <div className={item.status === "PROCESSING" ? "app-hero-art is-processing" : "app-hero-art"}>
        <Thumbnail src={item.thumbnailUrl} icon={view.icon} iconSize={48} />
        {item.status === "PROCESSING" && <span className="ng-badge">{t("item.analyzing")}</span>}
        <a className="app-hero-art__play" href={youtubeShort(item.videoId)} target="_blank" rel="noopener noreferrer">
          <YoutubeLogo size={16} weight="bold" aria-hidden />
          {t("item.openYoutube")}
        </a>
      </div>

      <section className="app-section">
        {item.category && (
          <span className="ng-card__meta">
            <span className={`ng-dot ${view.cssClass}`} aria-hidden />
            {t(view.label)}
            {meta && ` · ${meta}`}
          </span>
        )}
        <h1 className="t-title">{item.title ?? (item.status === "PROCESSING" ? t("item.analyzing") : t("item.untitled"))}</h1>
        {subtitle && <p className={item.status === "DISCARDED" || item.category === "EVENT" ? "t-body app-muted" : "t-body"}>{subtitle}</p>}
        {statusNote && <p className="t-caption app-muted">{statusNote}</p>}
      </section>

      <ItemDetails item={item} canCheck={item.status === "PENDING" || item.status === "DORMANT"} onToggle={toggle} />

      {item.status === "PENDING" && item.suggestDiscard && suggestion("item.suggestDiscard", btn("discard", t("item.discard"), discard, "danger"))}
      {item.status === "PENDING" && item.suggestDone && suggestion("item.suggestDone", btn("done", doneLabel, markDone, "secondary"))}
      {item.status === "PENDING" && eventPassed && suggestion("item.eventPassed", btn("done", doneLabel, markDone, "secondary"))}

      {hasActions && (
        <div className="app-actions">
          {group.primary}
          {group.secondary && group.secondary.length > 0 && <div className="app-actions-row app-actions-row--even">{group.secondary}</div>}
          {group.tertiary && group.tertiary.length > 0 && <div className="app-actions-row">{group.tertiary}</div>}
        </div>
      )}

      <Dialog open={overlay === "snooze"} title={t("item.snooze")} onClose={() => setOverlay(null)}>
        <p className="t-body app-muted">{t("item.snoozeSubtitle")}</p>
        <div className="app-options" role="radiogroup" aria-label={t("item.snooze")}>
          {(library.config?.snoozeOptions ?? [1, 3, 5]).map((n) => (
            <label key={n} className={n === snoozeChoice ? "app-radio-option is-selected" : "app-radio-option"}>
              <input type="radio" name="snooze-choice" checked={n === snoozeChoice} onChange={() => setSnoozeChoice(n)} />
              <span className="app-radio-option__body">
                <span className="t-body-strong">{snoozeLabel(n)}</span>
                <span className="t-caption app-muted">{snoozePreview(n)}</span>
              </span>
            </label>
          ))}
        </div>
        <button type="button" className="ng-btn ng-btn--primary ng-btn--block" onClick={() => snooze(snoozeChoice)} aria-busy={busy === "snooze"}>
          {t("item.snooze")}
        </button>
        <button type="button" className="ng-btn ng-btn--ghost ng-btn--block" onClick={() => setOverlay(null)}>
          {t("common.cancel")}
        </button>
      </Dialog>

      <Dialog open={overlay === "reschedule"} title={t("item.reschedule")} onClose={() => setOverlay(null)}>
        <p className="t-body app-muted">{t("item.rescheduleSubtitle")}</p>
        <Calendar value={date} min={localDate()} max={localDate(365)} today={localDate()} onChange={setDate} />
        {dateError && (
          <p className="ng-help" role="alert">
            {dateError}
          </p>
        )}
        <button type="button" className="ng-btn ng-btn--primary ng-btn--block" onClick={reschedule} aria-busy={busy === "reschedule"}>
          {t("item.rescheduleCta", { date: formatShortDate(new Date(`${date}T00:00:00`)) })}
        </button>
      </Dialog>

      <Dialog
        open={overlay === "delete"}
        title={t("item.deleteTitle")}
        onClose={() => setOverlay(null)}
        icon={
          <span className="app-dialog-icon is-danger" aria-hidden>
            <TrashSimple size={20} weight="bold" />
          </span>
        }
      >
        <p className="t-body app-muted">{t("item.deleteBody", { title: item.title ?? t("item.untitled") })}</p>
        <button type="button" className="ng-btn ng-btn--danger-solid ng-btn--block" onClick={destroy} aria-busy={busy === "delete"}>
          {t("item.delete")}
        </button>
        <button type="button" className="ng-btn ng-btn--ghost ng-btn--block" onClick={() => setOverlay(null)}>
          {t("common.cancel")}
        </button>
      </Dialog>
    </main>
  );
}
