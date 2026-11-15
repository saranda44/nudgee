/**
 * i18n mínimo: un diccionario por locale (hoy solo es-MX) y `t(key, params)`.
 * Sin librería: el MVP tiene un idioma y así no crece el bundle.
 */

import { ApiError, NetworkError } from "../api/client.ts";
import { esMX, type MessageKey } from "./es-MX.ts";

const messages: Record<MessageKey, string> = esMX;

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/**
 * Texto de un recordatorio (P-06) a partir de `messageKey`/`messageParams` (NTF-06,
 * backend/dispatcher/messages.ts): el backend manda la llave y los datos, nunca el texto —
 * así sobrevive al borrado del ítem y respeta i18n. `title` es el snapshot guardado en la
 * notificación, no el messageParams (que solo trae lo numérico: remaining/total, eventDate).
 */
export function reminderMessage(messageKey: string, messageParams: Record<string, string | number>, title: string): string {
  const key = messageKey as MessageKey;
  if (!(key in messages)) return title;
  if (key === "reminder.EVENT" && typeof messageParams.eventDate === "string") {
    const weekday = new Intl.DateTimeFormat("es-MX", { weekday: "long", timeZone: "UTC" }).format(
      new Date(`${messageParams.eventDate}T00:00:00Z`),
    );
    return t(key, { title, weekday });
  }
  return t(key, { ...messageParams, title });
}

/** Mensaje del catálogo (Contratos §2.5) para cualquier error de la API o de red. */
export function errorMessage(error: unknown): string {
  if (error instanceof NetworkError) return t("error.NETWORK");
  if (error instanceof ApiError) {
    if (error.code === "QUOTA_EXCEEDED") {
      return t("error.QUOTA_EXCEEDED", { minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)) });
    }
    if (error.status === 429) return t("error.THROTTLED");
    const key = `error.${error.code}` as MessageKey;
    if (key in messages) return t(key);
    if (error.status === 503) return t("error.SERVICE_UNAVAILABLE");
  }
  return t("error.INTERNAL_ERROR");
}
