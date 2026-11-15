/** Pantallas sin ruta propia (Diseño UX §1.5). */

import { Link } from "react-router";
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
