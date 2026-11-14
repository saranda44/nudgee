/**
 * Tarjeta de la biblioteca (sistema de diseño, ItemCard): variantes por estado y lista (US-44).
 * Toda la tarjeta es un enlace a P-03; en NEEDS_INPUT va directo a P-04.
 */

import { Check, CircleNotch, Moon } from "@phosphor-icons/react";
import { Link } from "react-router";
import { CATEGORY_VIEW } from "../domain/categories.ts";
import { daysUntil, relativeTime } from "../domain/format.ts";
import { listEntries, type Item } from "../domain/item.ts";
import { t } from "../i18n/index.ts";
import { Thumbnail } from "./Thumbnail.tsx";

export function ItemCard({ item }: { item: Item }) {
  if (item.status === "PROCESSING") {
    return (
      <Link to={`/items/${item.videoId}`} className="ng-card is-processing" aria-label={t("item.analyzing")}>
        <div className="ng-thumb">
          <CircleNotch size={28} weight="bold" className="ng-spin" aria-hidden />
          <span className="ng-badge">{t("item.analyzing")}</span>
        </div>
        <div className="ng-card__body" aria-hidden>
          <div className="ng-skel app-skel-90" />
          <div className="ng-skel app-skel-55" />
        </div>
      </Link>
    );
  }

  const view = CATEGORY_VIEW[item.category ?? "OTHER"];
  const entries = listEntries(item);
  const isList = entries.length > 1;
  const checked = entries.filter((e) => item.checklist[e.id]).length;
  const classes = ["ng-card", view.cssClass];
  if (item.status === "DONE") classes.push("is-done");
  if (item.status === "DISCARDED") classes.push("is-discarded");

  let meta: string;
  if (item.status === "NEEDS_INPUT") meta = t("item.needsInputMeta");
  else if (item.status === "DISCARDED" && item.expiresAt) meta = t("item.deletesIn", { days: daysUntil(item.expiresAt) });
  else if (isList) meta = `${t(view.label)} · ${t("item.progress", { done: checked, total: entries.length })}`;
  else meta = `${t(view.label)} · ${relativeTime(item.statusUpdatedAt ?? item.savedAt)}`;

  const to = item.status === "NEEDS_INPUT" ? `/items/${item.videoId}/edit` : `/items/${item.videoId}`;

  return (
    <Link to={to} className={classes.join(" ")}>
      <div className="ng-thumb">
        {isList ? (
          <>
            <div className="ng-stack" aria-hidden>
              <span />
              <span />
              <span>
                <view.icon size={28} weight="bold" />
              </span>
            </div>
            {entries.length > 1 && <span className="ng-badge ng-badge--count">+{entries.length - 1}</span>}
          </>
        ) : (
          <Thumbnail src={item.thumbnailUrl} icon={view.icon} />
        )}
        {item.status === "NEEDS_INPUT" && <span className="ng-badge ng-badge--accent">{t("item.complete")}</span>}
        {item.status === "DONE" && (
          <span className="ng-badge">
            <Check size={14} weight="bold" aria-hidden />
            {t("status.DONE")}
          </span>
        )}
        {item.status === "DORMANT" && (
          <span className="ng-badge">
            <Moon size={14} weight="bold" aria-hidden />
            {t("status.DORMANT")}
          </span>
        )}
      </div>
      <div className="ng-card__body">
        <p className="ng-card__title">{item.title ?? t("item.untitled")}</p>
        <span className="ng-card__meta">
          {item.category && <span className={`ng-dot ${view.cssClass}`} aria-hidden />}
          {meta}
        </span>
      </div>
    </Link>
  );
}

/** Rejilla de 2 columnas (3–4 en desktop). */
export function ItemGrid({ items }: { items: Item[] }) {
  return (
    <div className="ng-grid app-grid">
      {items.map((item) => (
        <ItemCard key={item.videoId} item={item} />
      ))}
    </div>
  );
}
