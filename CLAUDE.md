# Nudgee

PWA que convierte YouTube Shorts guardados en acciones concretas (IA con Gemini + recordatorios Web Push). Proyecto final de *Sistemas Escalables* (ITESO). Backend serverless en AWS (Learner Lab, `LabRole`), infraestructura efímera con Terraform.

## Fuentes de verdad (en este orden)

1. **El código del repo.** Si un documento contradice al código, gana el código; señala la discrepancia en lugar de "corregir" el código para que coincida con el doc.
2. `docs/` — exportaciones de Notion (RF, NFR, Modelo de datos, Contratos API, Arquitectura, Diseño UX). Pueden estar desactualizadas. Úsalas para el *por qué* y para los IDs de trazabilidad.
3. Sistema de diseño (artifact): https://claude.ai/artifact/PAufV5Xs4ZqK1W4QvKpdzR — `project/tokens.json`, `project/components/*/README.md`. Mockups: https://claude.ai/artifact/Euh4w8TGnENcemPxgHM2dH

Referencia los IDs de los documentos en código, commits y PRs: `US-xx`, `T-xx` (transiciones), `E-xx` (endpoints), `AP-xx`, `D-xx`, `NFR-xx`, `ARQ-xx`, `UX-xx`, `P-xx`/`O-xx` (pantallas/overlays).

## Estructura

```
backend/            Un package.json para todas las Lambdas (TypeScript, Node 20, CJS via esbuild)
  api/              Lambda API: router interno (router.ts) + rutas por archivo (E-01…E-22 excepto E-05)
  ingesta/          Lambda Ingesta: POST /v1/items (E-05)
  worker-ia/        Consumidor SQS FIFO → Gemini → DynamoDB; prompts/ versionados, fixtures/gemini
  dispatcher/       Invocada por EventBridge Scheduler; motor de recordatorios + Web Push
  post-auth/        Trigger Post Authentication de Cognito (upsert de PROFILE)
  dlq/              Consumidor de la DLQ FIFO (NEEDS_INPUT + RETRIES_EXHAUSTED)
  schemas/          Paquete compartido: TypeBox + Ajv, 10 categorías, schema plano de Gemini
  scripts/build.mjs Empaqueta cada Lambda en dist/<lambda>/index.js
infra/              Terraform: main.tf raíz + modules/<servicio>; bootstrap.sh crea el stack persistente
frontend/           (Fase 8, aún no existe) PWA React + Vite
```

## Comandos

```bash
cd backend && npm run typecheck   # tsc --noEmit — debe pasar antes de cada commit
cd backend && npm run build       # esbuild → dist/
cd infra && terraform fmt -check && terraform validate
```

`npm test` está **roto**: no existen archivos `*.test.ts`. No asumas que hay cobertura de tests.

## Convenciones del backend

- Imports relativos con extensión `.ts` (`allowImportingTsExtensions`). `strict: true`.
- Comentarios y logs en español; identificadores en inglés; campos JSON en `camelCase` iguales al modelo.
- Logs JSON en una línea con `level`, `correlationId`, `message`. **Nunca** email, nombre ni secretos en logs (NFR-08).
- Errores HTTP en RFC 9457 (`application/problem+json`) con `code` estable, vía `ProblemError` / `buildProblemResponse` de `api/problem.ts` (Ingesta tiene su propio `problem.ts`).
- `userId` **siempre** sale de `claims.sub` del JWT (`requireUserId(ctx)`), nunca del request (NFR-05).
- Escrituras de ítems: condicionales sobre `status` + `version`; `ETag`/`If-Match` → `412`/`428`. Checklist (E-18) no usa `If-Match` ni sube `version`.
- Validación del body con los schemas de `backend/schemas/` (Ajv, errores con JSON Pointer).
- Rutas nuevas: agregar al arreglo `*Routes` de su archivo y registrarlo en `api/index.ts`. Parámetros de ruta validados por `PARAM_PATTERNS` en `router.ts`.
- Links salientes solo desde plantillas de host fijo + `encodeURIComponent`; nunca un `href` de la IA o del usuario (NFR-06).
- Secretos en SSM SecureString (`/nudgee/...`), leídos en runtime. Nunca en código, tfvars commiteados ni docs.

## Frontend (Fase 8) — decisiones ya tomadas

React + Vite, mismo origen que la API vía CloudFront (`/v1/*`). En local, proxy de Vite a `/v1`. Auth: Cognito Hosted UI, Authorization Code + PKCE; access token en memoria, refresh token en IndexedDB. CSP estricta: prohibido `dangerouslySetInnerHTML` e inline scripts. Inter vía `@fontsource/inter`; íconos `@phosphor-icons/react` (Bold; Fill en el nav activo). Strings externalizados (es-MX, i18n). WCAG 2.2 AA, touch targets ≥ 44 px, móvil-first desde 360 px. Rutas y estados por pantalla: `docs/` Diseño UX §1.5 y §2.

## Reglas de trabajo

- Lee el código relacionado antes de cambiarlo; no asumas firmas ni formas de datos.
- No ejecutes `terraform apply`/`destroy`, `aws` con escrituras, ni `git push` sin confirmación explícita.
- No contradigas una decisión documentada en silencio: proponla con su trade-off y espera confirmación.
- Commits: Conventional Commits en español, con scope (`feat(api): …`, `fix(infra): …`). Una rama por feature; no commitear directo a `main`.
- Antes de commitear: `npm run typecheck` (y `terraform validate` si tocaste infra).
