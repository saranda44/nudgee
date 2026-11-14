/**
 * Textos es-MX (NFR-13). Los errores salen del catálogo de Contratos §2.5 y los estados de
 * Diseño UX §2. Tuteo, frases cortas, sin signos de exclamación (sistema de diseño, Voz).
 * Parámetros con {nombre}.
 */
export const esMX = {
  "app.name": "Nudgee",

  "nav.library": "Biblioteca",
  "nav.save": "Guardar video",
  "nav.reminders": "Recordatorios",
  "nav.account": "Cuenta",
  "nav.unread": "{count} sin leer",

  "login.title": "Convierte tus Shorts en planes",
  "login.subtitle": "Guarda un video y te recordamos hacerlo.",
  "login.cta": "Entrar",
  "login.expired": "Tu sesión expiró. Vuelve a entrar.",
  "login.failed": "No pudimos iniciar sesión. Intenta de nuevo.",
  "callback.loading": "Entrando…",

  "library.title": "Biblioteca",
  "reminders.title": "Recordatorios",
  "account.title": "Cuenta",
  "account.logout": "Cerrar sesión",
  "account.loggingOut": "Cerrando sesión…",

  "notFound.title": "No encontramos esta página",
  "notFound.cta": "Ir a la biblioteca",

  "offline.banner": "Sin conexión. Mostramos lo último que guardaste.",
  "common.retry": "Reintentar",
  "common.loading": "Cargando…",

  "error.INVALID_JSON": "Algo salió mal. Intenta de nuevo.",
  "error.INVALID_URL": "Ese link no es un YouTube Short. Revisa y vuelve a pegarlo.",
  "error.ITEM_NOT_FOUND": "Este video ya no está en tu biblioteca.",
  "error.DUPLICATE_ITEM": "Ya guardaste este video.",
  "error.INVALID_STATE_TRANSITION": "Esta acción ya no está disponible.",
  "error.VERSION_MISMATCH": "El ítem cambió en otro dispositivo. Revisa los cambios.",
  "error.QUOTA_EXCEEDED": "Llegaste al límite de guardados. Intenta de nuevo en {minutes} min.",
  "error.THROTTLED": "Hay mucho tráfico. Intenta en unos segundos.",
  "error.INTERNAL_ERROR": "Algo salió mal. Intenta de nuevo.",
  "error.SERVICE_UNAVAILABLE": "Servicio no disponible. Intenta en un momento.",
  "error.NETWORK": "Sin conexión. Intenta de nuevo.",
} as const;

export type MessageKey = keyof typeof esMX;
