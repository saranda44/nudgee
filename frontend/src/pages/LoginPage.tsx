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
    <main className="app-center">
      <div className="app-stack">
        <p className="t-headline app-muted">{t("app.name")}</p>
        <h1 className="t-display">{t("login.title")}</h1>
        <p className="t-body app-muted">{t("login.subtitle")}</p>
        {notice && (
          <p className="t-body-strong" role="alert">
            {notice}
          </p>
        )}
        <button type="button" className="ng-btn ng-btn--primary ng-btn--block" onClick={login} aria-busy={busy}>
          {t("login.cta")}
        </button>
      </div>
    </main>
  );
}
