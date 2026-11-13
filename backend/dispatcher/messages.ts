/**
 * Texto del recordatorio (Contratos §7): `messageKey` + `messageParams` para la bandeja
 * (instantánea i18n, NTF-06) y `title`/`body` ya resueltos en es-MX para el Web Push.
 */

const LIST_CATEGORIES = new Set(["MOVIE_SERIES", "PLACE", "BOOK", "MUSIC", "PODCAST"]);

/** Plantillas iniciales es-MX (Contratos §7). */
const PUSH_TITLES: Record<string, string> = {
  RECIPE: "¿Hoy la cocinas?",
  ROUTINE: "¿Hoy la haces?",
  TUTORIAL: "¿Hoy lo intentas?",
  MOVIE_SERIES: "¿Hoy ves algo?",
  PLACE: "¿Hoy vas?",
  BOOK: "¿Empiezas a leer?",
  MUSIC: "¿Lo escuchas hoy?",
  PODCAST: "¿Lo escuchas hoy?",
  EVENT: "Tu evento es el {fecha}",
  OTHER: "¿Hoy es el día?",
};
const EVENT_NO_DATE_TITLE = "¿Ya tienes plan?";
const FALLBACK_ITEM_TITLE = "Tu video guardado";

/** `{title}` se trunca para mantener el payload por debajo de 3 KB (Contratos §7). */
export const MAX_TITLE_LENGTH = 120;

export interface ReminderMessage {
  messageKey: string;
  messageParams: Record<string, string | number>;
  /** Título del ítem (truncado), para la bandeja y el body del push. */
  itemTitle: string;
  pushTitle: string;
  pushBody: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** `2026-10-13` → `13 de octubre` (fecha local; se formatea en UTC para no desplazarla). */
function formatEventDate(date: string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** Arma el mensaje a partir del ITEM completo (AP-12: GetItem del elegido). */
export function buildReminderMessage(item: Record<string, unknown>): ReminderMessage {
  const category = typeof item.category === "string" && item.category in PUSH_TITLES ? item.category : "OTHER";
  const itemTitle = truncate(typeof item.title === "string" && item.title ? item.title : FALLBACK_ITEM_TITLE, MAX_TITLE_LENGTH);
  const details = (item.details ?? {}) as Record<string, unknown>;

  if (category === "EVENT") {
    const eventDate = typeof item.eventDate === "string" ? item.eventDate : undefined;
    if (!eventDate) {
      return { messageKey: "reminder.EVENT.noDate", messageParams: {}, itemTitle, pushTitle: EVENT_NO_DATE_TITLE, pushBody: itemTitle };
    }
    return {
      messageKey: "reminder.EVENT",
      messageParams: { eventDate },
      itemTitle,
      pushTitle: PUSH_TITLES.EVENT.replace("{fecha}", formatEventDate(eventDate)),
      pushBody: itemTitle,
    };
  }

  if (LIST_CATEGORIES.has(category) && Array.isArray(details.entries)) {
    const checklist = (item.checklist ?? {}) as Record<string, unknown>;
    const entries = details.entries as Array<{ id?: unknown }>;
    const total = entries.length;
    const remaining = entries.filter((e) => typeof e.id !== "string" || checklist[e.id] !== true).length;
    return {
      messageKey: `reminder.${category}.list`,
      messageParams: { remaining, total },
      itemTitle,
      pushTitle: PUSH_TITLES[category],
      pushBody: remaining > 0 ? `${itemTitle} · Te faltan ${remaining} de ${total}` : itemTitle,
    };
  }

  return { messageKey: `reminder.${category}`, messageParams: {}, itemTitle, pushTitle: PUSH_TITLES[category], pushBody: itemTitle };
}
