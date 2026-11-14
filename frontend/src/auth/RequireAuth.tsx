/**
 * Protege las rutas con sesión. Sin refresh token → P-01 con `returnTo`; si la sesión muere a
 * media navegación (401 tras refrescar) → P-01 con "Tu sesión expiró" (Diseño UX §2).
 */

import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { onSessionExpired } from "../api/client.ts";
import { syncTimezone } from "../api/profile.ts";
import { hasSession } from "./session.ts";

let timezoneSynced = false;

export function RequireAuth() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "in" | "out">("checking");

  useEffect(() => {
    let alive = true;
    hasSession().then((ok) => alive && setState(ok ? "in" : "out"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => onSessionExpired(() => navigate("/login?expired=1", { replace: true })),
    [navigate],
  );

  useEffect(() => {
    if (state !== "in" || timezoneSynced) return;
    timezoneSynced = true;
    // Silencioso: si falla (sin red), se reintenta en el próximo arranque.
    syncTimezone().catch(() => {
      timezoneSynced = false;
    });
  }, [state]);

  if (state === "checking") return null;
  if (state === "out") {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  return <Outlet />;
}
