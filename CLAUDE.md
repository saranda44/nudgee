# Nudgee

PWA que convierte YouTube Shorts guardados en acciones concretas (IA con Gemini + recordatorios Web Push). Proyecto final de *Sistemas Escalables* (ITESO). Backend serverless en AWS (Learner Lab, `LabRole`), infraestructura efímera con Terraform.

## Fuentes de verdad (en este orden)

1. **El código del repo.** Si un documento contradice al código, gana el código; señala la discrepancia en lugar de "corregir" el código para que coincida con el doc.
2. `docs/` — exportaciones de Notion (RF, NFR, Modelo de datos, Contratos API, Arquitectura, Diseño UX). Pueden estar desactualizadas. Úsalas para el *por qué* y para los IDs de trazabilidad.
3. Sistema de diseño (artifact): https://claude.ai/artifact/PAufV5Xs4ZqK1W4QvKpdzR — `project/tokens.json`, `project/components/*/README.md`. Mockups: https://claude.ai/artifact/Euh4w8TGnENcemPxgHM2dH

Referencia los IDs de los documentos en código, commits y PRs: `US-xx`, `T-xx` (transiciones), `E-xx` (endpoints), `AP-xx`, `D-xx`, `NFR-xx`, `ARQ-xx`, `UX-xx`, `P-xx`/`O-xx` (pantallas/overlays).

## Estructura

```
backend/            Un package.json para todas las Lambdas (TypeScript, Node 22, CJS via esbuild)
  api/              Lambda API: router interno (router.ts) + rutas por archivo (E-01…E-22 excepto E-05)
  ingesta/          Lambda Ingesta: POST /v1/items (E-05)
  worker-ia/        Consumidor SQS FIFO → Gemini → DynamoDB; prompts/ versionados, fixtures/gemini
  dispatcher/       Invocada por EventBridge Scheduler; motor de recordatorios + Web Push
  post-auth/        Trigger Post Authentication de Cognito (upsert de PROFILE)
  dlq/              Consumidor de la DLQ FIFO (NEEDS_INPUT + RETRIES_EXHAUSTED)
  schemas/          Paquete compartido: TypeBox + Ajv, 10 categorías, schema plano de Gemini
  scripts/build.mjs Empaqueta cada Lambda en dist/<lambda>/index.js
infra/              Terraform: main.tf raíz + modules/<servicio>; bootstrap.sh crea el stack persistente
frontend/           PWA React + Vite (Fase 8, en curso): ver frontend/README.md (setup, estructura, estado por etapa)
```

## Comandos

```bash
cd backend && npm run typecheck   # tsc --noEmit — debe pasar antes de cada commit
cd backend && npm run build       # esbuild → dist/
cd infra && terraform fmt -check && terraform validate
cd frontend && npm run typecheck && npm test   # Vitest; npm run dev en :5173 (ver frontend/README.md)
```

```bash
cd backend && npm test            # node:test sobre **/*.test.ts (Node ≥ 22.18 en local; Lambda corre en Node 22)
```

Tests en `api/*.test.ts` (router, transiciones E-10…E-17, recurso Item, E-19, E-20) y `dispatcher/index.test.ts`; el resto no tiene cobertura. DynamoDB se mockea con `mockDdb`/`conditionalFailure` de `api/test-helpers.ts`, sin AWS (el `Item` de la falla condicional viene *marshalled*, igual que en el SDK real). Los tests con `{ todo: "bug: …" }` describen el contrato correcto y hoy fallan por bugs conocidos: al arreglar uno, quita su `todo`. Los imports de solo tipos deben ser `import type` (Node ejecuta `.ts` con type stripping; `aws-lambda` no existe en runtime).

Los mocks no detectan errores que solo DynamoDB real rechaza (palabras reservadas como `timezone`/`name`, sintaxis de `UpdateExpression`): después de desplegar, prueba con `curl` contra la API.

### Desplegar en tu Learner Lab

Cada integrante usa su propia cuenta y bucket de state; `providers.tf` trae el bucket de otra cuenta, así que se sobreescribe en `init` (sin editar el archivo):

```bash
cd backend && npm run build
cd infra
terraform init -reconfigure -backend-config="bucket=nudgee-tf-state-<ACCOUNT_ID>"
VAPID=$(aws ssm get-parameter --name /nudgee/VAPID_PUBLIC_KEY --with-decryption --query Parameter.Value --output text)
CF_TOKEN=$(aws ssm get-parameter --name /nudgee/CLOUDFLARE_API_TOKEN --with-decryption --query Parameter.Value --output text)
terraform plan -var "environment=dev-<nombre>" -var "vapid_public_key=$VAPID" \
  -var "domain_name=<tu-subdominio>" -var "cloudflare_zone_id=<tu-zone-id>" -var "cloudflare_api_token=$CF_TOKEN" \
  -out=tf.plan   # revisar antes de apply
terraform apply tf.plan

# VITE_API_BASE_URL (.env.production.local) = terraform output -raw api_endpoint, antes del build:
cd ../frontend && npm run build
../infra/deploy-frontend.sh \
  "$(terraform -chdir=../infra output -raw frontend_bucket)" \
  "$(terraform -chdir=../infra output -raw cognito_domain)" \
  "$(terraform -chdir=../infra output -raw api_endpoint)" \
  "<tu-zone-id>" "$CF_TOKEN"
```

Learner Lab no permite crear roles IAM: toda Lambda (y EventBridge Scheduler) usa `LabRole` vía `data "aws_iam_role"`.

**CloudFront no es viable en Learner Lab**: `cloudfront:CreateDistribution` (y antes, `CreateOriginAccessControl`/`CreateFunction`/`CreateResponseHeadersPolicy`/`ListCachePolicies`) está denegado en el role de `voclabs`. Por eso, a diferencia de ARQ §4.1: Cloudflare (ya al frente del dominio) hace de CDN/TLS en modo *proxied* sobre un bucket S3 público (sitio estático, `error_document = index.html` como SPA fallback — creado en `bootstrap.sh`, no por el `aws_s3_bucket` de Terraform, que también falla por una denegación de la SCP al leer la config de object lock); y el frontend le pega a la API **cross-origin** (`VITE_API_BASE_URL`, con el CORS que ya está en `infra/main.tf`) en vez de por `/v1/*` del mismo origen. El CSP va por `<meta>` tag en el build (`infra/deploy-frontend.sh`), sin `frame-ancestors`/HSTS/`X-Content-Type-Options` (un `<meta>` no los puede dar). `bootstrap.sh` necesita `DOMAIN_NAME`, `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_API_TOKEN` exportados la primera vez (ya no pide nada de ACM). El bucket del frontend se llama **exactamente igual que `domain_name`** (no `${project}-frontend-${env}`): el endpoint de sitio web de S3 identifica el bucket por el header `Host`, y Cloudflare proxied lo reenvía tal cual — reescribirlo con una Origin Rule es función de un plan de pago de Cloudflare, así que esta es la alternativa gratis (y es el patrón que documenta AWS); no choca entre integrantes porque un dominio registrado es único a nivel mundial.

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
