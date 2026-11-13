/**
 * Motor de recordatorios (RF §5) como funciones puras con reloj inyectable (NFR-11).
 * No hace I/O: recibe los candidatos de GSI1 y decide cuáles pasan a DORMANT y en qué
 * orden se intenta registrar el envío de la franja.
 */

/** Proyección de GSI1 (Modelo §4.2) más sus llaves. */
export interface Candidate {
  videoId: string;
  GSI1SK: string;
  title?: string;
  category?: string | null;
  snoozeUntil?: string;
  scheduledFor?: string;
  notifyCount?: number;
  lastNotifiedAt?: string;
  eventDate?: string;
}

export interface EngineConfig {
  /** Cooldown entre recordatorios del mismo ítem (US-41). */
  cooldownMinutes: number;
  /** Recordatorios ignorados antes de pasar a DORMANT (US-42, T-07). */
  maxReminders: number;
  /** Ventana de eventos próximos (US-50). */
  upcomingEventDays: number;
}

export const DEFAULT_CONFIG: EngineConfig = { cooldownMinutes: 3 * 24 * 60, maxReminders: 3, upcomingEventDays: 7 };

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  return {
    cooldownMinutes: positiveInt(env.REMINDER_COOLDOWN_MINUTES, DEFAULT_CONFIG.cooldownMinutes),
    maxReminders: positiveInt(env.REMINDER_MAX_PER_ITEM, DEFAULT_CONFIG.maxReminders),
    upcomingEventDays: positiveInt(env.UPCOMING_EVENT_DAYS, DEFAULT_CONFIG.upcomingEventDays),
  };
}

/** Fecha y hora local de `instant` en `timeZone`. */
function localParts(instant: Date, timeZone: string): { date: string; hour: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour };
}

/** `YYYY-MM-DD` local del usuario. */
export function localDate(instant: Date, timeZone: string): string {
  return localParts(instant, timeZone).date;
}

/** `slotKey` = fecha y hora local de la franja, `2026-10-13T09` (Modelo §3.4). */
export function slotKeyFor(instant: Date, timeZone: string): string {
  const { date, hour } = localParts(instant, timeZone);
  return `${date}T${hour}`;
}

/** Suma días a una fecha `YYYY-MM-DD` (aritmética de calendario, sin zona). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface EngineResult {
  /** notifyCount ≥ máximo: pasan a DORMANT antes de elegir (AP-15). */
  dormant: Candidate[];
  /** Elegibles en orden de prioridad; se registra el primero que gane la transacción (AP-13). */
  ordered: Candidate[];
}

/**
 * Aplica RF §5 a los candidatos:
 * - No elegibles: pospuestos (`snoozeUntil` > ahora), reprogramados para un día futuro,
 *   eventos con fecha pasada (US-49) y los que siguen en cooldown (US-41).
 * - Orden: 1) reprogramados para hoy o antes (desborde, US-40), por fecha; 2) eventos en los
 *   próximos N días, del más cercano al más lejano (US-50); 3) resto, del más viejo al más
 *   nuevo (US-39, `GSI1SK = {savedAt}#{videoId}`).
 * - Un reprogramado cuyo día ya llegó ignora el cooldown: el usuario eligió ese día.
 */
export function planSlot(candidates: Candidate[], now: Date, timeZone: string, config: EngineConfig): EngineResult {
  const today = localDate(now, timeZone);
  const eventHorizon = addDays(today, config.upcomingEventDays);
  const cooldownMs = config.cooldownMinutes * 60_000;

  const dormant: Candidate[] = [];
  const rescheduled: Candidate[] = [];
  const upcomingEvents: Candidate[] = [];
  const rest: Candidate[] = [];

  for (const c of candidates) {
    if ((c.notifyCount ?? 0) >= config.maxReminders) {
      dormant.push(c);
      continue;
    }
    if (c.snoozeUntil && new Date(c.snoozeUntil).getTime() > now.getTime()) continue;
    if (c.scheduledFor && c.scheduledFor > today) continue;

    const eventDate = c.category === "EVENT" ? c.eventDate : undefined;
    if (eventDate && eventDate < today) continue;

    if (c.scheduledFor) {
      rescheduled.push(c);
      continue;
    }
    if (c.lastNotifiedAt && now.getTime() - new Date(c.lastNotifiedAt).getTime() < cooldownMs) continue;

    if (eventDate && eventDate <= eventHorizon) upcomingEvents.push(c);
    else rest.push(c);
  }

  const byAge = (a: Candidate, b: Candidate) => a.GSI1SK.localeCompare(b.GSI1SK);
  rescheduled.sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!) || byAge(a, b));
  upcomingEvents.sort((a, b) => a.eventDate!.localeCompare(b.eventDate!) || byAge(a, b));
  rest.sort(byAge);

  return { dormant, ordered: [...rescheduled, ...upcomingEvents, ...rest] };
}
