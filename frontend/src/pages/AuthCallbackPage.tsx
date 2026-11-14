/** P-00 Callback (US-01): solo spinner mientras se intercambia el `code` (PKCE). */

import { CircleNotch } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { completeLogin } from "../auth/session.ts";
import { t } from "../i18n/index.ts";

/**
 * Un `code` solo se canjea una vez; StrictMode monta el efecto dos veces en desarrollo,
 * así que el intercambio se memoriza por URL.
 */
let inflight: { url: string; promise: Promise<string> } | null = null;

export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const url = window.location.href;
    if (inflight?.url !== url) inflight = { url, promise: completeLogin(url) };
    let alive = true;
    inflight.promise
      .then((returnTo) => alive && navigate(returnTo, { replace: true }))
      .catch(() => alive && navigate("/login?error=1", { replace: true }));
    return () => {
      alive = false;
    };
  }, [navigate]);

  return (
    <main className="app-center" aria-busy="true">
      <CircleNotch size={32} weight="bold" className="app-spin" aria-hidden />
      <span className="visually-hidden">{t("callback.loading")}</span>
    </main>
  );
}
