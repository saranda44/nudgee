# Nudgee — PWA (Fase 8)

React 19 + Vite + TypeScript (`strict`). Misma API que el backend, mismo origen (`/v1/*`).

## Arrancar en local

```bash
cd frontend
npm install
cp .env.example .env.development.local   # llena con `terraform output` de TU despliegue
npm run dev                               # http://localhost:5173 (puerto fijo: es el callback de Cognito)
```

- `API_PROXY_TARGET`: URL de tu API Gateway. Vite reenvía `/v1` ahí, así no hace falta CORS (en producción lo hará CloudFront).
- `VITE_COGNITO_DOMAIN` / `VITE_COGNITO_CLIENT_ID`: Hosted UI y cliente de tu user pool. El callback `http://localhost:5173/auth/callback` ya está registrado en `infra/main.tf`.

| Comando | Qué hace |
| --- | --- |
| `npm run typecheck` | `tsc -b` (app + tests). Debe pasar antes de cada commit |
| `npm test` | Vitest: PKCE/sesión, reglas de la biblioteca y links seguros |
| `npm run lint` | oxlint |
| `npm run build` | build de producción en `dist/` |
| `npm run tokens` | regenera `src/styles/tokens.css` desde `design/tokens.json` (sistema de diseño) |

## Estructura

```
design/tokens.json        Tokens del sistema de diseño (copia del artifact). No editar tokens.css a mano
src/
  App.tsx                 Rutas (Diseño UX §1.5)
  config.ts               Variables VITE_*
  auth/                   PKCE, sesión (access token en memoria, refresh en IndexedDB), RequireAuth
  api/                    client.ts (Bearer, 401→refresh una vez, ETag/If-Match, RFC 9457 → ApiError)
                          items.ts, profile.ts (una función por endpoint E-xx)
  domain/                 Lógica pura y testeable: tipos Item, categorías, biblioteca, links, fechas
  state/library.tsx       Biblioteca en memoria compartida + polling de PROCESSING (US-09)
  components/             BottomNav, SaveSheet (O-05), Dialog, ItemCard, CategoryFolder, ProcessingStrip,
                          ItemDetails, Toast, Thumbnail, Layouts
  pages/                  Una pantalla por archivo (P-xx); placeholders.tsx = lo que falta
  i18n/                   es-MX.ts (todos los textos) + t()/errorMessage()
  styles/                 tokens.css (generado), components.css (CSS de referencia del sistema de diseño)
```

## Convenciones

- **Textos:** nunca en el JSX; van en `src/i18n/es-MX.ts` y se usan con `t("clave", { params })`. Errores de la API: `errorMessage(e)` (catálogo de Contratos §2.5).
- **Estilos:** clases `ng-*` del sistema de diseño (`components.css`) y `app-*` propias en `index.css`, siempre con `var(--token)`. Sin `style={{}}` ni `dangerouslySetInnerHTML` (CSP estricta).
- **Íconos:** `@phosphor-icons/react`, `weight="bold"` (Fill solo en el destino activo del nav).
- **Escrituras de ítems:** `runAction(videoId, action, item.version)` manda `If-Match`; la respuesta se guarda con `useLibrary().upsert(item)`. `409`/`412` → toast + recargar la tarjeta (ver `ItemPage.tsx`).
- **Links salientes:** solo con las funciones de `domain/links.ts` (host fijo + parámetros codificados, NFR-06).
- **Accesibilidad:** objetivos ≥ 44 px (`--tap-min`), `aria-pressed` en chips, `aria-current` en el nav, `role="status"` en toasts, overlays con `<dialog>` nativo.
- **Tests:** solo lógica crítica (en `domain/` y `auth/`); las pantallas se prueban a mano.

## Estado (2026-11-15)

| Etapa | Contenido | Estado |
| --- | --- | --- |
| 1 | Base, tokens, rutas, bottom nav, i18n | Hecho |
| 2 | Login Cognito (PKCE), refresco, logout, E-04 silencioso | Hecho y probado |
| 3 | P-02 Biblioteca, P-07 Carpeta, O-05 Guardar, polling | Hecho y probado |
| 4 | P-03 Tarjeta, O-01/O-02/O-03, checklist, Deshacer | Hecho y probado (checklist requirió fix en E-18) |
| 5 | **P-04 Formulario** (`/items/:videoId/edit`): renderer desde los schemas, E-08/E-09, "¿Descartar cambios?" | Hecho y probado |
| 6 | Service worker de push, banner US-35/UX-07, E-20/E-21 en P-05, **P-06 Bandeja** (E-22) y contador de no leídos | Hecho y probado |
| 7 | Offline (NFR-12), manifest/íconos, edge del frontend (S3 + Cloudflare, CSP) | Hecho |

### Pistas para P-04 (etapa 5)

- Reemplaza `ItemEditPage` en `pages/placeholders.tsx` por `pages/ItemEditPage.tsx`.
- Contratos E-08 (editar, `PENDING`/`DORMANT`) y E-09 (formulario, `NEEDS_INPUT → PENDING`); ambos con `If-Match`. En `PROCESSING`, `DONE` o `DISCARDED` redirige a la tarjeta (UX-06).
- Campos por categoría: RF §3.1 y `backend/schemas/categories.ts`. Cambiar la categoría borra los campos específicos.
- `400 VALIDATION_ERROR` trae `errors[].pointer` (JSON Pointer, p. ej. `/details/ingredients/0/text`): error bajo cada campo y scroll al primero (`ApiError.fieldErrors`).
- Al guardar: `upsert(item)` y volver a `/items/:videoId`.

### Pistas para P-06 (etapa 6)

- Reemplaza `RemindersPage` en `pages/placeholders.tsx`. E-22 paginado con `cursor`; `unreadCount` solo en la primera página → pásalo a `BottomNav` (hoy recibe `0` en `components/Layouts.tsx`).
- Fila: componente ReminderRow del sistema de diseño (clases `ng-reminder*` en `components.css`). Tocar → `/items/{videoId}?slot={slotKey}` (P-03 ya llama a E-19).
- Texto desde `messageKey` + `messageParams` (añadir las claves a `es-MX.ts`); si el ítem no existe: "Este ítem ya no existe" sin enlace (API-18).
- Vacío: "Aún no tienes recordatorios. Llegan a las 9:00, 14:00 y 19:00." (Diseño UX §2).

### Desplegar la etapa 7 (edge del frontend)

- **CloudFront no es viable en Learner Lab**: `cloudfront:CreateDistribution` (y antes, `CreateOriginAccessControl`/`CreateFunction`/`CreateResponseHeadersPolicy`/`ListCachePolicies`) está denegado para el role de `voclabs`; el recurso `aws_s3_bucket` de Terraform también falla siempre, por una denegación de la SCP de la organización al leer la config de object lock. A diferencia del diseño original de ARQ §4.1:
  - El bucket del frontend lo crea `infra/bootstrap.sh` (AWS CLI, no Terraform) como sitio estático **público** (S3 website hosting), con `error_document = index.html` de SPA fallback. Se llama **exactamente igual que `domain_name`** (no `nudgee-frontend-<env>`): el endpoint de sitio web de S3 identifica el bucket por el header `Host`, y Cloudflare proxied lo reenvía tal cual — reescribirlo con una Origin Rule es función de un plan de pago de Cloudflare (probado), así que esto es la alternativa gratis. No choca entre integrantes: un dominio registrado es único a nivel mundial.
  - **Cloudflare** (ya al frente del dominio) hace de CDN/TLS en modo *proxied* — ya no hace falta ningún certificado ACM.
  - El frontend le pega a la API **cross-origin** (`VITE_API_BASE_URL` en `config.ts`, con el CORS que ya está en `infra/main.tf`), en vez de por `/v1/*` del mismo origen.
  - El CSP va por `<meta>` tag (inyectado en `infra/deploy-frontend.sh`, solo en el build subido — el `index.html` del repo queda intacto para no romper el HMR de Vite), sin `frame-ancestors`/HSTS/`X-Content-Type-Options`, que un `<meta>` no puede dar.
- `bootstrap.sh` necesita `DOMAIN_NAME`, `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_API_TOKEN` exportados, una sola vez (ver `CLAUDE.md`).
- Antes del `build`: pon `VITE_API_BASE_URL=<api_endpoint>` en `.env.production.local` (ver `.env.example`).
- Tras el `apply`: `npm run build` en `frontend/` y luego `infra/deploy-frontend.sh <bucket> <cognito_domain> <api_base_url> <cloudflare_zone_id> <cloudflare_api_token>` (outputs `frontend_bucket`/`cognito_domain`/`api_endpoint`) para subir `dist/` con los `Cache-Control` correctos, inyectar el CSP (incluye el origen de la API en `connect-src`) y purgar la caché de Cloudflare.
- `callback_urls`/`logout_urls` de Cognito ya incluyen `https://<domain_name>/...` además de `localhost:5173` — no hace falta tocarlos a mano tras el primer `apply`.
