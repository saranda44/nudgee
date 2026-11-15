import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

// US-35: registrado temprano para que esté listo cuando el usuario acepte notificaciones.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // domain/push.ts también lo registra (idempotente) justo antes de suscribir, así que un
    // fallo aquí no bloquea nada — pero conviene verlo en consola en vez de tragárselo en silencio.
    navigator.serviceWorker.register("/sw.js").catch((e: unknown) => console.warn("No se pudo registrar el service worker", e));
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
