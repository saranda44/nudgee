/**
 * Datos de la tarjeta por categoría (RF §3.1): listas marcables (E-18, US-26/US-45), pasos,
 * entradas con su link de búsqueda y el bloque de evento. Todo el texto es de la IA o del
 * usuario: React lo escapa y ningún href sale de él (NFR-06).
 */

import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ReactNode } from "react";
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

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="app-extlink" href={href} target="_blank" rel="noopener noreferrer">
      {label}
      <ArrowSquareOut size={16} weight="bold" aria-hidden />
    </a>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="app-section">
      <h2 className="t-headline">{title}</h2>
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
      const minutes = num(d.prepTime) ?? num(d.durationMin);
      return (
        <>
          {minutes !== undefined && <p className="t-body app-muted">{t("details.minutes", { minutes })}</p>}
          {list.length > 0 && (
            <Section title={t(`details.${listKey}`)}>
              <Checklist {...props} items={list} render={(el: CheckItem) => el.text} />
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
      return (
        <Section title={t("details.entries")}>
          <Checklist
            {...props}
            items={entries}
            render={(e: Entry) => {
              const v = entryView(item.category, e);
              return (
                <>
                  <span className="t-body-strong">{v.primary}</span>
                  {v.secondary && <span className="t-caption app-muted">{v.secondary}</span>}
                  <ExternalLink href={v.href} label={t(v.action)} />
                </>
              );
            }}
          />
        </Section>
      );
    }
    case "EVENT": {
      const name = str(d.name) ?? item.title ?? "";
      const date = str(d.eventDate);
      const time = str(d.eventTime);
      const place = str(d.cityOrAddress);
      return (
        <Section title={name}>
          <p className="t-body">
            {date ? new Date(`${date}T00:00:00`).toLocaleDateString("es-MX", { dateStyle: "full" }) : t("details.noDate")}
            {time && ` · ${time}`}
          </p>
          {place && <p className="t-body app-muted">{place}</p>}
          <div className="app-links">
            {place && <ExternalLink href={googleMaps(name, place)} label={t("details.openMaps")} />}
            {date && <ExternalLink href={googleCalendar({ name, eventDate: date, eventTime: time, cityOrAddress: place })} label={t("details.addToCalendar")} />}
            <ExternalLink href={ticketSearch(name, place)} label={t("details.findTickets")} />
          </div>
        </Section>
      );
    }
    default:
      return null;
  }
}
