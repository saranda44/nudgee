/**
 * Banner de permisos de push (US-35, UX-07): se ofrece una sola vez. Si el usuario lo descarta,
 * si el navegador ya decidió (permiso concedido o denegado) o si ya está suscrito, no vuelve a
 * aparecer — no hay nada que preguntar de nuevo.
 */

import { useState } from "react";
import { loadSubscriptionId, pushSupported, subscribeToPush } from "../domain/push.ts";
import { errorMessage, t } from "../i18n/index.ts";
import { useLibrary } from "../state/library.tsx";
import { useToast } from "./Toast.tsx";

const DISMISSED_KEY = "nudgee.pushBannerDismissed";

function alreadyDecided(): boolean {
  if (!pushSupported()) return true;
  if (Notification.permission !== "default") return true;
  if (loadSubscriptionId()) return true;
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function PushPermissionBanner() {
  const { config } = useLibrary();
  const toast = useToast();
  const [hidden, setHidden] = useState(alreadyDecided);
  const [busy, setBusy] = useState(false);

  if (hidden || !config?.vapidPublicKey) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // localStorage bloqueado: en la próxima carga se vuelve a mostrar, no es grave.
    }
    setHidden(true);
  };

  const enable = async () => {
    setBusy(true);
    try {
      await subscribeToPush(config.vapidPublicKey);
      toast({ message: t("push.enabled") });
      setHidden(true);
    } catch (e) {
      if (e instanceof Error && e.message === "push-permission-denied") dismiss();
      else if (e instanceof Error && e.message === "push-sw-timeout") toast({ message: t("push.timeout") });
      else toast({ message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-banner" role="note">
      <div className="app-banner__text">
        <p className="t-body-strong">{t("push.bannerTitle")}</p>
        <p className="t-caption app-muted">{t("push.bannerBody")}</p>
      </div>
      <div className="app-banner__actions">
        <button type="button" className="ng-btn ng-btn--primary" onClick={enable} aria-busy={busy}>
          {t("push.enable")}
        </button>
        <button type="button" className="ng-btn ng-btn--ghost" onClick={dismiss}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
