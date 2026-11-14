/**
 * P-07 Carpeta (US-11–US-13): título, chips de estado (`?status=`, default "Por hacer", UX-05)
 * y cuadrícula. Usa los datos ya cargados de la biblioteca (sin llamada propia).
 */

import { ArrowLeft } from "@phosphor-icons/react";
import { Link, useParams, useSearchParams } from "react-router";
import { ItemGrid } from "../components/ItemCard.tsx";
import { ALL_VIEW, CATEGORY_VIEW, categoryFromSlug } from "../domain/categories.ts";
import { folderItems, parseStatusFilter, STATUS_FILTERS, type StatusFilter } from "../domain/library.ts";
import { t } from "../i18n/index.ts";
import { useLibrary } from "../state/library.tsx";
import { NotFoundPage } from "./placeholders.tsx";

export function FolderPage() {
  const { category: slug } = useParams();
  const [params, setParams] = useSearchParams();
  const { items, status: loadStatus } = useLibrary();
  const category = categoryFromSlug(slug);
  if (!category) return <NotFoundPage />;

  const view = category === "all" ? ALL_VIEW : CATEGORY_VIEW[category];
  const filter = parseStatusFilter(params.get("status"));
  const visible = folderItems(items, category, filter);
  const setFilter = (next: StatusFilter) => setParams(next === "PENDING" ? {} : { status: next }, { replace: true });

  let content;
  if (loadStatus === "loading" && items.length === 0) {
    content = <p className="t-body app-muted">{t("common.loading")}</p>;
  } else if (visible.length > 0) {
    content = <ItemGrid items={visible} />;
  } else if (filter === "PENDING" && folderItems(items, category, "ALL").length > 0) {
    content = (
      <div className="app-empty">
        <p className="t-body">{t("folder.allDoneIn", { folder: t(view.label) })}</p>
      </div>
    );
  } else {
    content = (
      <div className="app-empty">
        <p className="t-body">{t("folder.emptyFilter", { status: t(`filter.${filter}`) })}</p>
        {filter !== "PENDING" && (
          <button type="button" className="ng-btn ng-btn--ghost" onClick={() => setFilter("PENDING")}>
            {t("folder.backToPending")}
          </button>
        )}
      </div>
    );
  }

  return (
    <main className="app-page app-page--with-nav">
      <div className="app-header">
        <Link to="/" className="app-iconbtn" aria-label={t("common.back")}>
          <ArrowLeft size={22} weight="bold" aria-hidden />
        </Link>
        <h1 className="t-display">{t(view.label)}</h1>
      </div>
      <div className="ng-chips" role="group" aria-label={t("folder.filters")}>
        {STATUS_FILTERS.map((f) => (
          <button key={f} type="button" className="ng-chip" aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {t(`filter.${f}`)}
          </button>
        ))}
      </div>
      {content}
    </main>
  );
}
