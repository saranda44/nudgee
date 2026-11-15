/**
 * Service worker de Nudgee: push (US-35) y shell cacheado para abrir sin red (NFR-12).
 * Payload del push, exacto al que manda el dispatcher (backend/dispatcher/index.ts):
 * { v, type: "REMINDER", slotKey, videoId, title, body, icon, url, correlationId }.
 * Vanilla, sin librerías — igual que el resto del frontend.
 */

const SHELL_CACHE = "nudgee-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Borra cachés de una versión anterior del shell (si algún día se sube SHELL_CACHE).
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("nudgee-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/**
 * NFR-12: el shell (HTML/JS/CSS/íconos) se guarda la primera vez que se pide, con la misma
 * respuesta real de la red — no hay una lista fija de archivos que precachear (Vite nombra los
 * bundles con un hash distinto en cada build, y este sw.js no pasa por ese build). `/v1/*`
 * (la API) nunca se cachea aquí: esos datos los guarda la propia app en IndexedDB.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/v1/")) return;

  // Navegación (abrir la app o cambiar de ruta con recarga completa): red primero, shell
  // guardado si no hay respuesta — así el usuario siempre ve el HTML más nuevo cuando sí hay red.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          (await caches.open(SHELL_CACHE)).put("/index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await (await caches.open(SHELL_CACHE)).match("/index.html");
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Assets (JS, CSS, íconos, manifest): lo que ya haya guardado responde al instante, y de paso
  // se refresca en segundo plano para la próxima vez (stale-while-revalidate).
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);
      return cached || (await network) || Response.error();
    })(),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  if (payload.type !== "REMINDER" || !payload.url) return;

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title || "Nudgee", {
        body: payload.body || "",
        icon: payload.icon,
        badge: payload.icon,
        tag: payload.slotKey,
        data: { url: payload.url },
      });
      // Avisa a las pestañas abiertas para que refresquen la bandeja y el contador sin recargar.
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) client.postMessage({ type: "NUDGEE_PUSH_RECEIVED" });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;
  const target = new URL(url, self.location.origin);

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
