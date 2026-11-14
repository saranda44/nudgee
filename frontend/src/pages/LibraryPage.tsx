/**
 * P-02 Biblioteca (US-09, US-11, US-12, US-14): buscador (`?q=`, UX-04/UX-11), franja En
 * proceso (UX-09) y carpetas (UX-08). El banner de push (US-35) llega en la etapa 6.
 */

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useSearchParams } from "react-router";
import { CategoryFolder } from "../components/CategoryFolder.tsx";
import { ItemGrid } from "../components/ItemCard.tsx";
import { ProcessingStrip } from "../components/ProcessingStrip.tsx";
import { useOpenSaveSheet } from "../components/SaveSheet.tsx";
import { buildFolders, inProgress, searchItems } from "../domain/library.ts";
import { t } from "../i18n/index.ts";
import { useLibrary } from "../state/library.tsx";

export function LibraryPage() {
  const { items, status, error, reload } = useLibrary();
  const openSave = useOpenSaveSheet();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";

  const setQuery = (value: string) => setParams(value ? { q: value } : {}, { replace: true });

  let content;
  if (status === "loading" && items.length === 0) {
    content = (
      <div className="ng-folders" aria-busy="true" aria-label={t("common.loading")}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="app-folder-skel" />
        ))}
      </div>
    );
  } else if (status === "error" && items.length === 0) {
    content = (
      <div className="app-empty" role="alert">
        <p className="t-body">{error}</p>
        <button type="button" className="ng-btn ng-btn--ghost" onClick={reload}>
          {t("common.retry")}
        </button>
      </div>
    );
  } else if (query.trim()) {
    const results = searchItems(items, query);
    content =
      results.length > 0 ? (
        <ItemGrid items={results} />
      ) : (
        <div className="app-empty">
          <p className="t-body">{t("library.noResults", { query: query.trim() })}</p>
          <button type="button" className="ng-btn ng-btn--ghost" onClick={() => setQuery("")}>
            {t("library.clearSearch")}
          </button>
        </div>
      );
  } else if (items.length === 0) {
    content = (
      <div className="app-empty">
        <p className="t-body app-muted">{t("library.empty")}</p>
        <button type="button" className="ng-btn ng-btn--primary" onClick={openSave}>
          {t("library.emptyCta")}
        </button>
      </div>
    );
  } else {
    content = (
      <>
        <ProcessingStrip items={inProgress(items)} />
        <div className="ng-folders">
          {buildFolders(items).map((folder) => (
            <CategoryFolder key={folder.category} folder={folder} />
          ))}
        </div>
      </>
    );
  }

  return (
    <main className="app-page app-page--with-nav">
      <h1 className="t-display">{t("library.title")}</h1>
      <div className="app-search" role="search">
        <MagnifyingGlass size={20} weight="bold" aria-hidden />
        <input
          className="ng-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("library.searchPlaceholder")}
          aria-label={t("library.searchPlaceholder")}
        />
      </div>
      {content}
    </main>
  );
}
