/** Reglas de la biblioteca: carpetas (UX-08/UX-10), "por hacer" (UX-05), franja (UX-09), búsqueda (UX-11). */

import { describe, expect, it } from "vitest";
import type { Item } from "./item.ts";
import { buildFolders, folderItems, inProgress, searchItems } from "./library.ts";

let n = 0;
function item(over: Partial<Item>): Item {
  n += 1;
  return {
    videoId: `vid${String(n).padStart(8, "0")}`,
    sourceUrl: "",
    thumbnailUrl: `https://i.ytimg.com/vi/${n}/hqdefault.jpg`,
    status: "PENDING",
    category: "RECIPE",
    title: null,
    summary: null,
    details: null,
    checklist: {},
    confidence: null,
    dataSource: "AI",
    analysisSource: null,
    analysisError: null,
    savedAt: `2026-06-${String(n).padStart(2, "0")}T00:00:00Z`,
    readyAt: null,
    statusUpdatedAt: null,
    snoozeUntil: null,
    scheduledFor: null,
    snoozeCount: 0,
    suggestDiscard: false,
    suggestDone: false,
    notifyCount: 0,
    lastNotifiedAt: null,
    expiresAt: null,
    version: 1,
    ...over,
  };
}

describe("buildFolders", () => {
  it("Todo primero y luego categorías con ítems en el orden de RF §3.1, no por actividad", () => {
    const items = [item({ category: "EVENT" }), item({ category: "RECIPE" }), item({ category: "BOOK" })];
    expect(buildFolders(items).map((f) => f.category)).toEqual(["all", "RECIPE", "BOOK", "EVENT"]);
  });

  it("cuenta como por hacer solo PENDING; PROCESSING y NEEDS_INPUT no entran a carpetas", () => {
    const items = [
      item({ status: "PENDING" }),
      item({ status: "DONE" }),
      item({ status: "DORMANT" }),
      item({ status: "PROCESSING", category: null }),
      item({ status: "NEEDS_INPUT", category: null }),
    ];
    const [all, recipe] = buildFolders(items);
    expect(all.pendingCount).toBe(1);
    expect(recipe.pendingCount).toBe(1);
    expect(inProgress(items).map((i) => i.status)).toEqual(["NEEDS_INPUT", "PROCESSING"]);
  });

  it("solo ítems en proceso → sin carpetas", () => {
    expect(buildFolders([item({ status: "PROCESSING", category: null })])).toEqual([]);
  });

  it("las 3 miniaturas más recientes", () => {
    const items = [1, 2, 3, 4].map(() => item({}));
    expect(buildFolders(items)[0].thumbnails).toEqual(items.slice(1).reverse().map((i) => i.thumbnailUrl));
  });
});

describe("folderItems", () => {
  it("filtra por categoría y estado, más reciente primero", () => {
    const a = item({ category: "BOOK" });
    const b = item({ category: "BOOK" });
    const done = item({ category: "BOOK", status: "DONE" });
    item({ category: "RECIPE" });
    expect(folderItems([a, b, done], "BOOK", "PENDING")).toEqual([b, a]);
    expect(folderItems([a, b, done], "BOOK", "ALL")).toEqual([done, b, a]);
  });
});

describe("searchItems", () => {
  it("ignora mayúsculas y acentos; exige todas las palabras", () => {
    const pasta = item({ title: "Pasta cremosa", summary: "Con ajo y PARMESANO" });
    const pelicula = item({ title: "5 películas de terror" });
    expect(searchItems([pasta, pelicula], "peliculas")).toEqual([pelicula]);
    expect(searchItems([pasta, pelicula], "pasta parmesano")).toEqual([pasta]);
    expect(searchItems([pasta, pelicula], "pasta terror")).toEqual([]);
    expect(searchItems([pasta, pelicula], "   ")).toEqual([]);
  });
});
