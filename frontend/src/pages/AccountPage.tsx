/**
 * P-05 Cuenta (US-03): nombre, correo y cerrar sesión. El bloque de push de este dispositivo
 * (US-35, E-20/E-21) llega en la etapa 6.
 */

import { useEffect, useState } from "react";
import { getProfile, type Profile } from "../api/profile.ts";
import { logout } from "../auth/session.ts";
import { errorMessage, t } from "../i18n/index.ts";

export function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getProfile(ctrl.signal).then(setProfile, (e: unknown) => {
      if ((e as Error).name !== "AbortError") setError(errorMessage(e));
    });
    return () => ctrl.abort();
  }, []);

  const onLogout = () => {
    setLeaving(true);
    void logout();
  };

  return (
    <main className="app-page app-page--with-nav">
      <h1 className="t-display">{t("account.title")}</h1>
      {profile && (
        <section>
          <p className="t-headline">{profile.name}</p>
          <p className="t-body app-muted">{profile.email}</p>
        </section>
      )}
      {error && (
        <p className="t-body app-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="ng-btn ng-btn--ghost" onClick={onLogout} aria-busy={leaving}>
        {leaving ? t("account.loggingOut") : t("account.logout")}
      </button>
    </main>
  );
}
