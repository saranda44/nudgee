/** Layouts: raíz (toasts y barra sin conexión), sesión (biblioteca + O-05) y bottom nav (P-02, P-05, P-06, P-07). */

import { useSyncExternalStore } from "react";
import { Outlet } from "react-router";
import { t } from "../i18n/index.ts";
import { LibraryProvider } from "../state/library.tsx";
import { BottomNav } from "./BottomNav.tsx";
import { SaveSheetProvider, useOpenSaveSheet } from "./SaveSheet.tsx";
import { ToastProvider } from "./Toast.tsx";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function RootLayout() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  return (
    <ToastProvider>
      {!online && (
        <div className="app-offline t-caption" role="status">
          {t("offline.banner")}
        </div>
      )}
      <Outlet />
    </ToastProvider>
  );
}

/** Rutas con sesión: biblioteca en memoria y sheet O-05 disponibles en todas. */
export function SessionLayout() {
  return (
    <LibraryProvider>
      <SaveSheetProvider>
        <Outlet />
      </SaveSheetProvider>
    </LibraryProvider>
  );
}

export function NavLayout() {
  const openSave = useOpenSaveSheet();
  return (
    <>
      <Outlet />
      {/* El contador de no leídos (US-52) llega en la etapa 6. */}
      <BottomNav unreadCount={0} onSave={openSave} />
    </>
  );
}
