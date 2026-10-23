/**
 * Validación y canonicalización de links de YouTube Shorts.
 *
 * - Solo https:// de youtube.com, www.youtube.com o m.youtube.com, ruta /shorts/{videoId}.
 * - Se ignoran query string y fragment.
 * - Máx. 2,048 caracteres.
 * - Se reconstruye la URL canónica; nunca se guarda la pegada por el usuario.
 * - thumbnailUrl sale de una plantilla fija con encodeURIComponent, nunca de la IA.
 */

const MAX_URL_LENGTH = 2048;
const ALLOWED_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SHORTS_PATH_PATTERN = /^\/shorts\/([A-Za-z0-9_-]+)\/?$/;

export interface ParsedShortsUrl {
  videoId: string;
  sourceUrl: string;
  thumbnailUrl: string;
}

/**
 * Valida y canonicaliza un link. Devuelve null si no es un YouTube Short válido
 * (el caller responde 400 INVALID_URL).
 */
export function parseShortsUrl(rawUrl: unknown): ParsedShortsUrl | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return null;
  }

  const match = SHORTS_PATH_PATTERN.exec(parsed.pathname);
  if (!match) {
    return null;
  }

  const videoId = match[1];
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  return {
    videoId,
    sourceUrl: `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
  };
}
