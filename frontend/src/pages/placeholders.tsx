/** Pantallas sin ruta propia (Diseño UX §1.5). */

import { Link, useRouteError } from "react-router";
import { t } from "../i18n/index.ts";

/** P-404 */
export function NotFoundPage() {
  return (
    <main className="app-center">
      <div className="app-stack">
        <h1 className="t-title">{t("notFound.title")}</h1>
        <Link to="/" className="ng-btn ng-btn--primary">
          {t("notFound.cta")}
        </Link>
      </div>
    </main>
  );
}

/** Fallback de la raíz del router (errorElement): un error que ninguna pantalla capturó con su
 *  propio estado "error" (ver ItemPage/ItemEditPage). Reemplaza todo RootLayout, así que no hay
 *  toasts ni barra de sin conexión aquí — solo recargar o volver al inicio. */
export function ErrorPage() {
  const error = useRouteError();
  console.error(error);
  return (
    <main className="app-center">
      <div className="app-stack">
        <h1 className="t-title">{t("error.pageTitle")}</h1>
        <p className="t-body app-muted">{t("error.pageBody")}</p>
        <button type="button" className="ng-btn ng-btn--primary" onClick={() => window.location.reload()}>
          {t("error.reload")}
        </button>
        <Link to="/" className="ng-btn ng-btn--ghost">
          {t("notFound.cta")}
        </Link>
      </div>
    </main>
  );
}
