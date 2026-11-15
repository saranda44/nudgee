/**
 * Datos de la tarjeta por categoría (RF §3.1): listas marcables (E-18, US-26/US-45), pasos,
 * entradas con su link de búsqueda y el bloque de evento. Todo el texto es de la IA o del
 * usuario: React lo escapa y ningún href sale de él (NFR-06).
 */

import { ArrowSquareOut, CalendarPlus, MapPin, Ticket } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { formatShortDate } from "../domain/format.ts";
import type { Item } from "../domain/item.ts";
import { googleBooks, googleCalendar, googleMaps, justWatch, spotifySearch, ticketSearch } from "../domain/links.ts";
import { t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/es-MX.ts";

type Entry = Record<string, string | number | undefined> & { id: string };
type CheckItem = { id: string; text: string };

interface Props {
  item: Item;
  /** Solo en PENDING y DORMANT (RF §4.4). */
  canCheck: boolean;
  onToggle: (id: string, checked: boolean) => void;
}

function ExternalLink({ href, label, pill }: { href: string; label: string; pill?: boolean }) {
  return (
    <a className={pill ? "app-entry-link" : "app-extlink"} href={href} target="_blank" rel="noopener noreferrer">
      {label}
      <ArrowSquareOut size={16} weight="bold" aria-hidden />
    </a>
  );
}

function Section({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="app-section">
      <div className="app-section__head">
        <h2 className="t-headline">{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  );
}

function Checklist({ items, item, canCheck, onToggle, render }: Props & { items: Array<{ id: string }>; render: (el: never) => ReactNode }) {
  return (
    <ul className="app-checklist">
      {items.map((el) => (
        <li key={el.id}>
          <label className="app-check">
            <input
              type="checkbox"
              checked={item.checklist[el.id] === true}
              disabled={!canCheck}
              onChange={(e) => onToggle(el.id, e.target.checked)}
            />
            <span className="app-check__body">{render(el as never)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

const ENTRY_DONE_NOUN: Partial<Record<NonNullable<Item["category"]>, MessageKey>> = {
  MOVIE_SERIES: "details.entriesDoneNoun.MOVIE_SERIES",
  PLACE: "details.entriesDoneNoun.PLACE",
  BOOK: "details.entriesDoneNoun.BOOK",
  MUSIC: "details.entriesDoneNoun.MUSIC",
  PODCAST: "details.entriesDoneNoun.PODCAST",
};

/** Metadato junto al punto de categoría (P-03): minutos para RECIPE/ROUTINE/TUTORIAL,
 *  número de entradas para las categorías de lista. `null` si no hay nada que mostrar. */
export function categoryMeta(item: Item): string | null {
  const d = item.details ?? {};
  switch (item.category) {
    case "RECIPE":
    case "ROUTINE":
    case "TUTORIAL": {
      const minutes = num(d.prepTime) ?? num(d.durationMin);
      return minutes !== undefined ? t("details.minutes", { minutes }) : null;
    }
    case "MOVIE_SERIES":
    case "PLACE":
    case "BOOK":
    case "MUSIC":
    case "PODCAST": {
      const count = arr(d.entries).length;
      return count > 0 ? t("details.entryCount", { count }) : null;
    }
    case "EVENT": {
      const date = str(d.eventDate);
      if (!date) return null;
      const short = formatShortDate(new Date(`${date}T00:00:00`));
      const time = str(d.eventTime);
      return time ? `${short}, ${time}` : short;
    }
    default:
      return null;
  }
}

/** Título y link de cada entrada de lista, según la categoría. */
function entryView(category: Item["category"], e: Entry): { primary: string; secondary?: string; href: string; action: MessageKey } {
  switch (category) {
    case "MOVIE_SERIES": {
      const title = str(e.title) ?? "";
      const kind = e.mediaType === "SERIES" ? t("details.series") : t("details.movie");
      return { primary: title, secondary: [kind, num(e.year)].filter(Boolean).join(" · "), href: justWatch(title, num(e.year)), action: "details.whereToWatch" };
    }
    case "PLACE": {
      const name = str(e.name) ?? "";
      return { primary: name, secondary: str(e.cityOrAddress), href: googleMaps(name, str(e.cityOrAddress)), action: "details.openMaps" };
    }
    case "BOOK": {
      const title = str(e.title) ?? "";
      return { primary: title, secondary: str(e.author), href: googleBooks(title, str(e.author)), action: "details.findBook" };
    }
    case "MUSIC": {
      const name = str(e.name) ?? "";
      return { primary: name, secondary: [str(e.artist), str(e.genre)].filter(Boolean).join(" · "), href: spotifySearch(name, str(e.artist)), action: "details.listen" };
    }
    default: {
      const show = str(e.showName) ?? "";
      return { primary: show, secondary: str(e.episode), href: spotifySearch(show, str(e.episode)), action: "details.listen" };
    }
  }
}

export function ItemDetails(props: Props) {
  const { item } = props;
  const d = item.details ?? {};

  switch (item.category) {
    case "RECIPE":
    case "ROUTINE":
    case "TUTORIAL": {
      const listKey = item.category === "RECIPE" ? "ingredients" : item.category === "ROUTINE" ? "exercises" : "materials";
      const list = arr<CheckItem>(d[listKey]);
      const steps = arr<string>(d.steps);
      const doneCount = list.filter((el) => item.checklist[el.id] === true).length;
      // Hecho: ya no aporta nada mostrar "N de N" (la tarjeta de arriba ya dice que está hecho).
      const progressMeta =
        item.status === "DONE" ? undefined : (
          <span className="t-caption app-muted">{t("item.progress", { done: doneCount, total: list.length })}</span>
        );
      return (
        <>
          {list.length > 0 && (
            <Section title={t(`details.${listKey}`)} meta={progressMeta}>
              <Checklist {...props} items={list} render={(el: CheckItem) => <span className="app-check__label">{el.text}</span>} />
            </Section>
          )}
          {steps.length > 0 && (
            <Section title={t("details.steps")}>
              <ol className="app-steps">
                {steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </Section>
          )}
        </>
      );
    }
    case "MOVIE_SERIES":
    case "PLACE":
    case "BOOK":
    case "MUSIC":
    case "PODCAST": {
      const entries = arr<Entry>(d.entries);
      if (entries.length === 0) return null;
      const doneCount = entries.filter((e) => item.checklist[e.id] === true).length;
      const doneNoun = ENTRY_DONE_NOUN[item.category];
      const isDone = item.status === "DONE";
      return (
        <Section
          title={t("details.yourList")}
          meta={
            !isDone &&
            doneNoun && (
              <span className="t-caption app-muted">
                {t("details.entriesProgress", { done: doneCount, total: entries.length, noun: t(doneNoun) })}
              </span>
            )
          }
        >
          {!isDone && <progress className="app-progressbar" value={doneCount} max={entries.length} />}
          <Checklist
            {...props}
            items={entries}
            render={(e: Entry) => {
              const v = entryView(item.category, e);
              return (
                <div className="app-entry-row">
                  <span className="app-entry-row__text">
                    <span className="t-body-strong">{v.primary}</span>
                    {v.secondary && <span className="t-caption app-muted">{v.secondary}</span>}
                  </span>
                  <ExternalLink href={v.href} label={t(v.action)} pill />
                </div>
              );
            }}
          />
        </Section>
      );
    }
    case "EVENT": {
      // Fecha y lugar ya están arriba (meta de categoría y resumen de la tarjeta, ItemPage): aquí
      // solo quedan las acciones, como pills a lo ancho con su ícono.
      const name = str(d.name) ?? item.title ?? "";
      const date = str(d.eventDate);
      const time = str(d.eventTime);
      const place = str(d.cityOrAddress);
      return (
        <div className="app-options">
          {place && (
            <a className="ng-btn ng-btn--ghost ng-btn--block" href={googleMaps(name, place)} target="_blank" rel="noopener noreferrer">
              <MapPin size={18} weight="bold" aria-hidden />
              {t("details.openMaps")}
            </a>
          )}
          {date && (
            <a
              className="ng-btn ng-btn--ghost ng-btn--block"
              href={googleCalendar({ name, eventDate: date, eventTime: time, cityOrAddress: place })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <CalendarPlus size={18} weight="bold" aria-hidden />
              {t("details.addToCalendar")}
            </a>
          )}
          <a className="ng-btn ng-btn--ghost ng-btn--block" href={ticketSearch(name, place)} target="_blank" rel="noopener noreferrer">
            <Ticket size={18} weight="bold" aria-hidden />
            {t("details.findTickets")}
          </a>
        </div>
      );
    }
    default:
      return null;
  }
}
