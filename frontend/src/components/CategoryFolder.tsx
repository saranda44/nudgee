/**
 * Carpeta de categoría (sistema de diseño, CategoryFolder; UX-08): 3 miniaturas como papeles,
 * frente de vidrio, sticker con el ícono y contador "N por hacer" o "Todo hecho".
 */

import { Check } from "@phosphor-icons/react";
import { Link } from "react-router";
import { ALL_VIEW, CATEGORY_VIEW } from "../domain/categories.ts";
import type { Folder } from "../domain/library.ts";
import { t } from "../i18n/index.ts";
import { Thumbnail } from "./Thumbnail.tsx";

export function CategoryFolder({ folder }: { folder: Folder }) {
  const view = folder.category === "all" ? ALL_VIEW : CATEGORY_VIEW[folder.category];
  // El tercer papel (el de más al frente, que tapa a los otros dos) va último en el arreglo: si
  // faltan miniaturas, el hueco debe quedar atrás, no tapando a la que sí existe.
  const shown = folder.thumbnails.slice(0, 3);
  const papers = [...Array<null>(Math.max(0, 3 - shown.length)).fill(null), ...shown];

  return (
    <Link to={`/library/${view.slug}`} className={`ng-folder ${view.cssClass}`}>
      <div className="ng-folder__art" aria-hidden>
        <div className="ng-folder__back" />
        {papers.map((src, i) => (
          <div key={i} className="ng-folder__paper">
            {src && <Thumbnail src={src} icon={view.icon} iconSize={20} />}
          </div>
        ))}
        <div className="ng-folder__front" />
        <div className="ng-folder__sticker">
          <view.icon size={22} weight="bold" />
        </div>
      </div>
      <p className="ng-folder__name">{t(view.label)}</p>
      {folder.pendingCount > 0 ? (
        <span className="ng-folder__count">{t("folder.pending", { count: folder.pendingCount })}</span>
      ) : (
        <span className="ng-folder__count is-clear">
          <Check size={12} weight="bold" aria-hidden />
          {t("folder.allDone")}
        </span>
      )}
    </Link>
  );
}
