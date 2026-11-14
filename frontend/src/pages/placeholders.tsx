/**
 * Pantallas aún sin implementar (etapas 3–6 del plan). Cada una se reemplaza por su archivo
 * propio cuando se construya; las rutas ya quedan fijas según Diseño UX §1.5.
 */

import { Link, useParams } from "react-router";
import { t } from "../i18n/index.ts";

function Pending({ title, withNav = true }: { title: string; withNav?: boolean }) {
  return (
    <main className={withNav ? "app-page app-page--with-nav" : "app-page"}>
      <h1 className="t-display">{title}</h1>
      <p className="t-body app-muted">En construcción.</p>
    </main>
  );
}

/** P-02 */
export const LibraryPage = () => <Pending title={t("library.title")} />;
/** P-07 */
export function FolderPage() {
  const { category } = useParams();
  return <Pending title={category ?? ""} />;
}
/** P-03 */
export function ItemPage() {
  const { videoId } = useParams();
  return <Pending title={videoId ?? ""} withNav={false} />;
}
/** P-04 */
export function ItemEditPage() {
  const { videoId } = useParams();
  return <Pending title={videoId ?? ""} withNav={false} />;
}
/** P-06 */
export const RemindersPage = () => <Pending title={t("reminders.title")} />;

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
