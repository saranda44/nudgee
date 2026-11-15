/** Formatos de fecha relativos (es-MX). */

const rtf = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "hace 2 días", "ayer", "hace 5 minutos", "ahora". */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, "minute");
}

/** Días completos que faltan para `iso` (mínimo 0), para "Se eliminará en X días" (US-43). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Agrupa por día de calendario local (no por ventanas de 24 h), para las secciones de P-06. */
export function dayBucket(iso: string, now = new Date()): "today" | "yesterday" | "week" | "earlier" {
  const day = localDay(new Date(iso));
  if (day === localDay(now)) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDay(yesterday)) return "yesterday";
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  return day > localDay(weekAgo) ? "week" : "earlier";
}

/** "lun", "mar"… sin el punto que agrega Intl en es-MX. */
export function shortWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { weekday: "short" }).replace(/[.,]/g, "").trim();
}

/** "9:00", "14:00": siempre 24 h, sin cero a la izquierda en la hora. */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", hour12: false });
}

/** "vie 6 nov": vista corta para Posponer, Reprogramar, "La hiciste el…" y la meta de EVENT. */
export function formatShortDate(d: Date): string {
  return d
    .toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
