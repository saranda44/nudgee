#!/usr/bin/env node
// Empaqueta cada Lambda con esbuild: un bundle por Lambda en dist/{nombre}/index.js,
// con sus dependencias de node_modules incluidas (tsc solo las compila, no las empaqueta).
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const LAMBDAS = ["ingesta", "worker-ia", "post-auth", "dlq", "api"];

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

  console.log(`✓ ${lambda} -> dist/${lambda}/index.js`);
}
