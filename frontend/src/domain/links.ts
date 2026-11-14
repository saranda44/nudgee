/**
 * Links salientes (RF §3.1, NFR-06): solo plantillas de host fijo con parámetros codificados
 * por URLSearchParams / encodeURIComponent. Nunca un `href` que venga de la IA o del usuario.
 */

const enc = encodeURIComponent;
const join = (...parts: Array<string | number | null | undefined>) =>
  parts.filter((p) => p !== null && p !== undefined && String(p).trim() !== "").join(" ");

export const youtubeShort = (videoId: string) => `https://www.youtube.com/shorts/${enc(videoId)}`;

export const justWatch = (title: string, year?: number) =>
  `https://www.justwatch.com/mx/buscar?${new URLSearchParams({ q: join(title, year) })}`;

export const googleMaps = (name: string, cityOrAddress?: string) =>
  `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: join(name, cityOrAddress) })}`;

export const googleBooks = (title: string, author?: string) =>
  `https://www.google.com/search?${new URLSearchParams({ tbm: "bks", q: join(title, author) })}`;

export const spotifySearch = (...terms: Array<string | undefined>) => `https://open.spotify.com/search/${enc(join(...terms))}`;

export const ticketSearch = (name: string, cityOrAddress?: string) =>
  `https://www.google.com/search?${new URLSearchParams({ q: join(name, cityOrAddress, "boletos") })}`;

/**
 * Evento de Google Calendar. Con hora: 2 h de duración en hora local (sin zona, Calendar
 * usa la del usuario). Sin hora: evento de todo el día.
 */
export function googleCalendar(ev: { name: string; eventDate: string; eventTime?: string; cityOrAddress?: string }) {
  const day = ev.eventDate.replace(/-/g, "");
  let dates: string;
  if (ev.eventTime) {
    const [h, m] = ev.eventTime.split(":").map(Number);
    const start = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), h, m));
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15);
    dates = `${fmt(start)}/${fmt(end)}`;
  } else {
    const next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8) + 1));
    dates = `${day}/${next.toISOString().slice(0, 10).replace(/-/g, "")}`;
  }
  const params = new URLSearchParams({ action: "TEMPLATE", text: ev.name, dates });
  if (ev.cityOrAddress) params.set("location", ev.cityOrAddress);
  return `https://calendar.google.com/calendar/render?${params}`;
}
