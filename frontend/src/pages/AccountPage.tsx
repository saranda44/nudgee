/** P-05 Cuenta (US-03, US-35): perfil, recordatorios de este dispositivo (E-20/E-21) y cerrar sesión. */

import { Bell, BellSlash, Check, Clock, Globe, PencilSimple, SignOut, X } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { getProfile, updateProfile, type Profile } from "../api/profile.ts";
import { logout } from "../auth/session.ts";
import { useToast } from "../components/Toast.tsx";
import { loadSubscriptionId, pushSupported, subscribeToPush, unsubscribeFromPush } from "../domain/push.ts";
import { errorMessage, t } from "../i18n/index.ts";
import { useLibrary } from "../state/library.tsx";

/** "Sara Aranda" → "SA" para el avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function AccountPage() {
  const { config } = useLibrary();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [subscribed, setSubscribed] = useState(() => Boolean(loadSubscriptionId()));
  const [pushBusy, setPushBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameBusy, setNameBusy] = useState(false);

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

  const startEditName = () => {
    setNameInput(profile?.name ?? "");
    setEditingName(true);
  };

  const cancelEditName = () => setEditingName(false);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === profile?.name) {
      setEditingName(false);
      return;
    }
    setNameBusy(true);
    try {
      setProfile(await updateProfile({ name: trimmed }));
      setEditingName(false);
    } catch (e) {
      toast({ message: errorMessage(e) });
    } finally {
      setNameBusy(false);
    }
  };

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
        toast({ message: t("account.pushDisabled") });
      } else {
        if (!config?.vapidPublicKey) throw new Error("no-config");
        await subscribeToPush(config.vapidPublicKey);
        setSubscribed(true);
        toast({ message: t("account.pushEnabled") });
      }
    } catch (e) {
      if (e instanceof Error && e.message === "push-permission-denied") toast({ message: t("account.pushBlocked") });
      else if (e instanceof Error && e.message === "push-sw-timeout") toast({ message: t("push.timeout") });
      else toast({ message: errorMessage(e) });
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <main className="app-page app-page--with-nav">
      <h1 className="t-display">{t("account.title")}</h1>
      {profile && (
        <section className="app-profile">
          <span className="app-avatar" aria-hidden>
            {initials(profile.name || profile.email)}
          </span>
          <span className="app-profile__text">
            {editingName ? (
              <form className="app-profile__edit" onSubmit={saveName}>
                <input
                  className="ng-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={100}
                  autoFocus
                  aria-label={t("account.editName")}
                />
                <button type="submit" className="app-iconbtn" aria-label={t("common.save")} aria-busy={nameBusy}>
                  <Check size={18} weight="bold" aria-hidden />
                </button>
                <button type="button" className="app-iconbtn" onClick={cancelEditName} aria-label={t("common.cancel")}>
                  <X size={18} weight="bold" aria-hidden />
                </button>
              </form>
            ) : (
              <button type="button" className="app-profile__name" onClick={startEditName}>
                <span className={profile.name ? "t-headline" : "t-headline app-muted"}>
                  {profile.name || t("account.namePlaceholder")}
                </span>
                <PencilSimple size={14} weight="bold" aria-hidden />
              </button>
            )}
            <span className="t-body app-muted">{profile.email}</span>
          </span>
        </section>
      )}
      {error && (
        <p className="t-body app-error" role="alert">
          {error}
        </p>
      )}

      <section className="app-section">
        <p className="t-headline">{t("account.remindersSection")}</p>
        <div className="ng-inbox">
          <div className="ng-reminder">
            <span className="ng-reminder__icon is-neutral" aria-hidden>
              {subscribed ? <Bell size={20} weight="bold" /> : <BellSlash size={20} weight="bold" />}
            </span>
            <span className="ng-reminder__text">
              <span className="ng-reminder__msg">{t("account.pushRowTitle")}</span>
              <span className="ng-reminder__meta">{subscribed ? t("account.pushStatusOn") : t("account.pushStatusOff")}</span>
            </span>
            {pushSupported() ? (
              <button
                type="button"
                className={subscribed ? "ng-btn ng-btn--ghost" : "ng-btn ng-btn--primary"}
                onClick={togglePush}
                aria-busy={pushBusy}
              >
                {subscribed ? t("account.pushDisable") : t("account.pushEnable")}
              </button>
            ) : (
              <span className="t-caption app-muted">{t("account.pushUnsupported")}</span>
            )}
          </div>

          <div className="ng-reminder">
            <span className="ng-reminder__icon is-neutral" aria-hidden>
              <Clock size={20} weight="bold" />
            </span>
            <span className="ng-reminder__text">
              <span className="ng-reminder__msg">{t("account.scheduleTitle")}</span>
              <span className="ng-reminder__meta">{t("account.scheduleBody")}</span>
            </span>
          </div>

          {profile?.timezone && (
            <div className="ng-reminder">
              <span className="ng-reminder__icon is-neutral" aria-hidden>
                <Globe size={20} weight="bold" />
              </span>
              <span className="ng-reminder__text">
                <span className="ng-reminder__msg">{t("account.timezoneTitle")}</span>
                <span className="ng-reminder__meta">{t("account.timezoneValue", { tz: profile.timezone })}</span>
              </span>
            </div>
          )}
        </div>
      </section>

      <button type="button" className="ng-btn ng-btn--ghost ng-btn--block" onClick={onLogout} aria-busy={leaving}>
        <SignOut size={18} weight="bold" aria-hidden />
        {leaving ? t("account.loggingOut") : t("account.logout")}
      </button>
    </main>
  );
}
