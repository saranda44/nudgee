/** Layouts de la app: raíz (barra sin conexión) y con bottom nav (P-02, P-05, P-06, P-07). */

import { useSyncExternalStore } from "react";
import { Outlet } from "react-router";
import { t } from "../i18n/index.ts";
import { BottomNav } from "./BottomNav.tsx";

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
    <>
      {!online && (
        <div className="app-offline t-caption" role="status">
          {t("offline.banner")}
        </div>
      )}
      <Outlet />
    </>
  );
}

export function NavLayout() {
  return (
    <>
      <Outlet />
      {/* El sheet O-05 y el contador de no leídos (US-52) llegan en las etapas 3 y 6. */}
      <BottomNav unreadCount={0} onSave={() => undefined} />
    </>
  );
}
