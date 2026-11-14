/** Presentación de las categorías (sistema de diseño, tabla de Categorías; RF §3.1). */

import {
  Barbell,
  BookmarkSimple,
  BookOpen,
  CalendarBlank,
  CookingPot,
  FilmSlate,
  MapPin,
  Microphone,
  MusicNotes,
  SquaresFour,
  Wrench,
  type Icon,
} from "@phosphor-icons/react";
import type { MessageKey } from "../i18n/es-MX.ts";
import type { Category } from "./item.ts";

export interface CategoryView {
  /** Segmento de ruta de P-07 (`/library/:category`). */
  slug: string;
  label: MessageKey;
  cssClass: string;
  icon: Icon;
}

export const CATEGORY_VIEW: Record<Category, CategoryView> = {
  RECIPE: { slug: "recipe", label: "category.RECIPE", cssClass: "cat-recipe", icon: CookingPot },
  ROUTINE: { slug: "routine", label: "category.ROUTINE", cssClass: "cat-routine", icon: Barbell },
  TUTORIAL: { slug: "tutorial", label: "category.TUTORIAL", cssClass: "cat-tutorial", icon: Wrench },
  MOVIE_SERIES: { slug: "movie-series", label: "category.MOVIE_SERIES", cssClass: "cat-movie", icon: FilmSlate },
  PLACE: { slug: "place", label: "category.PLACE", cssClass: "cat-place", icon: MapPin },
  BOOK: { slug: "book", label: "category.BOOK", cssClass: "cat-book", icon: BookOpen },
  MUSIC: { slug: "music", label: "category.MUSIC", cssClass: "cat-music", icon: MusicNotes },
  PODCAST: { slug: "podcast", label: "category.PODCAST", cssClass: "cat-podcast", icon: Microphone },
  EVENT: { slug: "event", label: "category.EVENT", cssClass: "cat-event", icon: CalendarBlank },
  OTHER: { slug: "other", label: "category.OTHER", cssClass: "cat-other", icon: BookmarkSimple },
};

/** Carpeta "Todo" (`/library/all`). */
export const ALL_VIEW: CategoryView = { slug: "all", label: "category.all", cssClass: "cat-all", icon: SquaresFour };

export function categoryFromSlug(slug: string | undefined): Category | "all" | null {
  if (slug === "all") return "all";
  const entry = Object.entries(CATEGORY_VIEW).find(([, v]) => v.slug === slug);
  return entry ? (entry[0] as Category) : null;
}
