#!/usr/bin/env node
// Convierte design/tokens.json (sistema de diseño Nudgee) en src/styles/tokens.css.
// Tema claro en :root y oscuro según prefers-color-scheme. Correr con `npm run tokens`
// cada vez que cambie tokens.json; el CSS generado se commitea.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tokens = JSON.parse(readFileSync(path.join(root, "design/tokens.json"), "utf8"));

const light = [];
const dark = [];
const add = ({ name, value }) => {
  if (typeof value === "object") {
    light.push(`  --${name}: ${value.light};`);
    dark.push(`    --${name}: ${value.dark};`);
  } else {
    light.push(`  --${name}: ${value};`);
  }
};

tokens.color.tokens.forEach(add);
for (const group of ["spacing", "radius", "shadow", "size"]) tokens[group].tokens.forEach(add);
light.push(`  --font-sans: ${tokens.type.families.sans};`);

const typeClasses = tokens.type.groups
  .flatMap((g) => g.styles)
  .map(
    (s) =>
      `.t-${s.name} { font: ${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-sans);` +
      (s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : "") +
      " }",
  );

const css = `/* Generado por scripts/build-tokens.mjs desde design/tokens.json. No editar a mano. */
:root {
  color-scheme: light dark;
${light.join("\n")}
}

@media (prefers-color-scheme: dark) {
  :root {
${dark.join("\n")}
  }
}

${typeClasses.join("\n")}
`;

writeFileSync(path.join(root, "src/styles/tokens.css"), css);
console.log("✓ src/styles/tokens.css");
