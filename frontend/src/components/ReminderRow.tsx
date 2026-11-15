/**
 * Fila de la bandeja (P-06, UX §1.5, sistema de diseño: ng-inbox/ng-reminder). "Este ítem ya no
 * existe" si el video ya no está en la biblioteca (NTF-06, API-18): sin enlace, el click no hace nada.
 */

import { Question } from "@phosphor-icons/react";
import { Link } from "react-router";
import type { Notification } from "../api/notifications.ts";
import { CATEGORY_VIEW } from "../domain/categories.ts";
import { dayBucket, shortTime, shortWeekday } from "../domain/format.ts";
import type { Category } from "../domain/item.ts";
import { reminderMessage, t } from "../i18n/index.ts";

/** "14:00" en Hoy/Ayer (sin ambigüedad); "lun 9:00" en grupos de varios días. */
function metaTime(sentAt: string): string {
  const bucket = dayBucket(sentAt);
  return bucket === "today" || bucket === "yesterday" ? shortTime(sentAt) : `${shortWeekday(sentAt)} ${shortTime(sentAt)}`;
}

export function ReminderRow({
  notification: n,
  exists,
  onOpen,
}: {
  notification: Notification;
  exists: boolean;
  onOpen: () => void;
}) {
  const time = metaTime(n.sentAt);

  if (!exists) {
    return (
      <div className="ng-reminder is-missing is-read">
        <span className="ng-reminder__icon is-missing" aria-hidden>
          <Question size={20} weight="bold" />
        </span>
        <span className="ng-reminder__text">
          <span className="ng-reminder__msg">{t("reminders.itemMissing")}</span>
          <span className="ng-reminder__meta">{time}</span>
        </span>
      </div>
    );
  }

  const view = CATEGORY_VIEW[(n.category ?? "OTHER") as Category];
  const unread = !n.openedAt;
  const title = n.title || t("item.untitled");

  return (
    <Link
      to={`/items/${n.videoId}?slot=${encodeURIComponent(n.slotKey)}`}
      className={unread ? "ng-reminder" : "ng-reminder is-read"}
      onClick={() => unread && onOpen()}
    >
      <span className={`ng-reminder__icon ${view.cssClass}`} aria-hidden>
        <view.icon size={20} weight="bold" />
      </span>
      <span className="ng-reminder__text">
        <span className="ng-reminder__msg">{reminderMessage(n.messageKey, n.messageParams, title)}</span>
        <span className="ng-reminder__meta">
          {t(view.label)} · {time}
        </span>
      </span>
      {unread && <span className="ng-reminder__unread" aria-hidden />}
    </Link>
  );
}
