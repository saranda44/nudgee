/** P-01 Login (US-01, US-02): un botón al Hosted UI de Cognito. Sin bottom nav. */

import { useState } from "react";
import { useSearchParams } from "react-router";
import { startLogin } from "../auth/session.ts";
import { t } from "../i18n/index.ts";

export function LoginPage() {
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const notice = params.get("expired") ? t("login.expired") : params.get("error") ? t("login.failed") : null;

  const login = () => {
    setBusy(true);
    startLogin(params.get("returnTo") ?? "/").catch(() => setBusy(false));
  };

  return (
    <main className="app-login">
      <img src="/logo-png-transparente.png" alt="" className="app-login__art" />
      <h1 className="app-login__title">{t("app.name")}</h1>
      <p className="app-login__subtitle app-muted">{t("login.subtitle")}</p>
      {notice && (
        <p className="t-body-strong app-error" role="alert">
          {notice}
        </p>
      )}
      <div className="app-login__spacer" aria-hidden />
      <button type="button" className="ng-btn ng-btn--secondary ng-btn--block app-login__cta" onClick={login} aria-busy={busy}>
        {t("login.cta")}
      </button>
    </main>
  );
}
