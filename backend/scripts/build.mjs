#!/usr/bin/env node
// Empaqueta cada Lambda con esbuild: un bundle por Lambda en dist/{nombre}/index.js,
// con sus dependencias de node_modules incluidas (tsc solo las compila, no las empaqueta).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const LAMBDAS = ["ingesta", "worker-ia", "post-auth", "dlq", "api"];
/** Carpetas estáticas que viajan junto al bundle de ciertas Lambdas (ej. el prompt de Gemini). */
const STATIC_ASSETS = {
  "worker-ia": ["prompts"],
};

for (const lambda of LAMBDAS) {
  const outdir = path.join(root, "dist", lambda);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  await build({
    entryPoints: [path.join(root, lambda, "index.ts")],
    outfile: path.join(outdir, "index.js"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    minify: true,
    sourcemap: false,
    logLevel: "info",
  });

  for (const asset of STATIC_ASSETS[lambda] ?? []) {
    cpSync(path.join(root, lambda, asset), path.join(outdir, asset), { recursive: true });
  }

  console.log(`✓ ${lambda} -> dist/${lambda}/index.js`);
}
