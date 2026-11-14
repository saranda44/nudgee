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
