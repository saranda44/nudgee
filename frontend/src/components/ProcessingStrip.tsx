/**
 * Franja "En proceso" (UX-09): PROCESSING y NEEDS_INPUT. Solo se muestra si hay ítems.
 * NEEDS_INPUT va directo a P-04.
 */

import { CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { Link } from "react-router";
import type { Item } from "../domain/item.ts";
import { t } from "../i18n/index.ts";

/** Sin título todavía: se muestra la URL canónica sin esquema. */
const label = (item: Item) => item.title ?? item.sourceUrl.replace(/^https:\/\/(www\.)?/, "");

export function ProcessingStrip({ items }: { items: Item[] }) {
  if (items.length === 0) return null;
  return (
    <section className="ng-strip" aria-labelledby="strip-title">
      <div className="ng-strip__head">
        <h2 className="ng-strip__title" id="strip-title">
          {t("strip.title")}
        </h2>
        <span className="ng-label">{items.length}</span>
      </div>
      <div className="ng-strip__row">
        {items.map((item) =>
          item.status === "NEEDS_INPUT" ? (
            <Link key={item.videoId} to={`/items/${item.videoId}/edit`} className="ng-mini is-needs-input">
              <span className="ng-mini__thumb">
                <WarningCircle size={22} weight="bold" aria-hidden />
              </span>
              <span className="ng-mini__text">
                <span className="ng-mini__title">{label(item)}</span>
                <span className="ng-mini__status">{t("strip.needsInput")}</span>
              </span>
            </Link>
          ) : (
            <Link key={item.videoId} to={`/items/${item.videoId}`} className="ng-mini">
              <span className="ng-mini__thumb">
                <CircleNotch size={22} weight="bold" className="ng-spin" aria-hidden />
              </span>
              <span className="ng-mini__text">
                <span className="ng-mini__title">{label(item)}</span>
                <span className="ng-mini__status">{t("item.analyzing")}</span>
              </span>
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
