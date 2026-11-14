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
  "library.searchPlaceholder": "Buscar en tu biblioteca",
  "library.noResults": "No encontramos «{query}».",
  "library.clearSearch": "Borrar búsqueda",
  "library.empty": "Pega el link de un Short y lo convertimos en un plan.",
  "library.emptyCta": "Guardar mi primer video",
  "library.ready": "Listo: «{title}» está en «{folder}»",

  "strip.title": "En proceso",
  "strip.needsInput": "Completar datos",

  "folder.pending": "{count} por hacer",
  "folder.allDone": "Todo hecho",
  "folder.allDoneIn": "Todo hecho en «{folder}».",
  "folder.emptyFilter": "Nada por aquí en «{status}».",
  "folder.backToPending": "Ver Por hacer",
  "folder.filters": "Filtrar por estado",

  "filter.ALL": "Todos",
  "filter.PENDING": "Por hacer",
  "filter.DORMANT": "Dormidos",
  "filter.DONE": "Hechos",
  "filter.DISCARDED": "Descartados",

  "status.DONE": "Hecho",
  "status.DORMANT": "Dormido",

  "category.all": "Todo",
  "category.RECIPE": "Receta",
  "category.ROUTINE": "Rutina",
  "category.TUTORIAL": "Tutorial",
  "category.MOVIE_SERIES": "Película o serie",
  "category.PLACE": "Lugar",
  "category.BOOK": "Libro",
  "category.MUSIC": "Música",
  "category.PODCAST": "Podcast",
  "category.EVENT": "Evento",
  "category.OTHER": "Otro",

  "item.analyzing": "Analizando…",
  "item.complete": "Completar",
  "item.needsInputMeta": "No pudimos leer el video",
  "item.untitled": "Sin título",
  "item.progress": "{done} de {total}",
  "item.deletesIn": "Se eliminará en {days} días",

  "save.title": "Guardar video",
  "save.label": "Link del Short",
  "save.help": "Pégalo y toca Guardar. Nosotros hacemos el resto.",
  "save.cta": "Guardar",
  "save.saving": "Guardando…",
  "save.saved": "Guardado. Lo estamos analizando.",
  "save.restore": "Restaurar",
  "save.restored": "Restaurado.",

  "reminders.title": "Recordatorios",
  "account.title": "Cuenta",
  "account.logout": "Cerrar sesión",
  "account.loggingOut": "Cerrando sesión…",

  "notFound.title": "No encontramos esta página",
  "notFound.cta": "Ir a la biblioteca",

  "offline.banner": "Sin conexión. Mostramos lo último que guardaste.",
  "common.retry": "Reintentar",
  "common.loading": "Cargando…",
  "common.view": "Ver",
  "common.back": "Atrás",

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
