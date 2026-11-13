# Contratos de API (REST)

| Campo | Valor |
| --- | --- |
| Producto | Nudgee |
| Documento | Contratos de la API REST del MVP |
| Versión | 1.1 |
| Fecha | 15 de octubre de 2026 |
| Responsable | Sara Aranda |
| Contexto | Proyecto final de *Sistemas Escalables* (ITESO) — Entregable #5 (parte 1 de 2) |
| Estado | Confirmado (parte 1). La parte 2 (OpenAPI 3.1 y JSON Schemas por categoría) está pendiente |
| Documentos relacionados | `Nudgee_Requerimientos_Funcionales_MVP.md` (v1.4), `Nudgee_Requerimientos_No_Funcionales_MVP.md` (v1.3), `Nudgee_Modelo_de_Datos.md` (v1.2) |

## Historial de cambios

| Versión | Cambios |
| --- | --- |
| 0.1 | Borrador inicial: decisiones API-01…API-14, convenciones, recurso `Item`, catálogo de errores y 17 endpoints. La parte 2 del entregable (OpenAPI 3.1 y JSON Schemas por categoría) se hará en la siguiente iteración |
| 1.0 | Confirmado: decisiones API-08…API-14 aceptadas; cambios de §9 aplicados en RF v1.3, NFR v1.2 y Modelo de datos v1.1 |
| 1.1 | Alineación con RF v1.4 y Modelo v1.2: enum de 10 categorías; listas `entries[]`; checklist genérico (E-18 con `UNKNOWN_CHECKLIST_ITEM` y `suggestDone` en la respuesta); campos `analysisSource` y `suggestDone` en el recurso `Item`; límites de E-08 para pasos, elementos y entradas; asignación de IDs (API-15); `eventPassed` se calcula en el cliente (API-16); encolado en SQS FIFO (E-05); textos de la push por categoría (§7) |

---

---

# 1. Decisiones de diseño

| ID | Decisión | Trade-off | Estado | Trazabilidad |
| --- | --- | --- | --- | --- |
| API-01 | **Endpoints de acción** para las transiciones: un `POST /items/{videoId}/{acción}` por evento | Más rutas, pero cada una mapea 1:1 a una T-xx y a una escritura condicional; la máquina de estados vive solo en el servidor | Confirmada | T-04…T-11, AP-06 |
| API-02 | `ETag` y `If-Match` (**optimistic locking**) con el `version` del ítem. Conflicto → `412`; header ausente → `428` | Estándar HTTP y body limpio; el cliente debe guardar el `ETag` de cada ítem | Confirmada | AP-06, AP-07 |
| API-03 | Errores en **RFC 9457** (`application/problem+json`) con extensión `code` estable | `code` se mapea a mensajes i18n en la PWA (NFR-13); los errores del *authorizer* y del *throttling* de API Gateway no siguen este formato | Confirmada | NFR-10, NFR-13 |
| API-04 | Prefijo **`/v1`** | Costo nulo; permite cambios incompatibles post-MVP | Confirmada | — |
| API-05 | Guardar un duplicado → **`409`** con el `videoId` y `status` del existente | La UI distingue "guardado" (`202`) de "ya lo tenías" (`409`) y ofrece abrir o restaurar | Confirmada | US-07, D-02 |
| API-06 | Biblioteca con **paginación por cursor**; polling con **`?ids=`** (`BatchGetItem`) | El polling solo lee los ítems en análisis, no toda la colección. El cliente trae todas las páginas para buscar y filtrar en local | Confirmada | US-09, US-11–US-14, AP-03 |
| API-07 | Apertura desde la push con **`POST /notifications/{slotKey}/open`** | Una llamada extra al abrir, pero `GET` queda sin efectos secundarios y cacheable por el Service Worker | Confirmada | US-38, D-04, AP-14 |
| API-08 | El identificador del ítem en la ruta es el **`videoId`** (llave natural) | Sin IDs sintéticos ni índices extra; el `videoId` no es secreto (es público en YouTube) y la ruta siempre se combina con el `userId` del token | Confirmada | D-02, NFR-05 |
| API-09 | **El perfil (`email`, `name`, `lastLoginAt`) lo escribe un trigger *Post Authentication* de Cognito**; la API solo expone `GET/PATCH /me` | El *access token* de Cognito no trae `email` ni `name`, y no queremos usar el *ID token* para autorizar. Agrega una Lambda al Terraform | Confirmada | AP-01, NFR-08 |
| API-10 | **`GET /v1/config`** entrega llave pública VAPID y valores configurables (franjas, opciones de posponer, retención) | Evita *hardcodear* en el build valores que cambian entre demo y producción (NFR-11) | Confirmada | NFR-09, NFR-11 |
| API-11 | **Posponer y reprogramar son excluyentes**: posponer borra `scheduledFor` y reprogramar borra `snoozeUntil` | Evita estados ambiguos (¿gana la prioridad o la espera?). Es una regla nueva para RF §4.5 | Confirmada | US-19, US-20, US-40 |
| API-12 | **El orden de las páginas no es cronológico** (la SK es `ITEM#{videoId}`); el cliente ordena por `savedAt` tras traer todas las páginas | No requiere un GSI nuevo. Si en el futuro se quiere "scroll infinito" ordenado, se necesitaría un GSI por `savedAt` | Confirmada | AP-03, D-02 |
| API-13 | El `endpoint` de una suscripción push solo se acepta si su host está en una **lista blanca** de *push services* | Evita SSRF desde la Lambda despachadora; si un navegador usa un host nuevo hay que agregarlo | Confirmada | NFR-06 |
| API-14 | Los duplicados y las URLs inválidas **no consumen cuota** | La cuota protege el presupuesto de Gemini, y esos casos no llegan a Gemini | Confirmada | NFR-07 |
| API-15 | **IDs de elementos y entradas:** el cliente manda los existentes con su `id` y los nuevos sin `id`. El servidor asigna `i{n}` a los elementos marcables y `e{n}` a las entradas, con `n` = máximo actual + 1. Un `id` enviado que no existe produce `400` | Si se borra el último elemento, su `id` puede reutilizarse, pero sin efecto: en la misma escritura el checklist descarta las marcas de los `id` que ya no existen (D-03) | Confirmada | US-32, US-44, D-03, D-07 |
| API-16 | **`suggestDone` lo calcula el servidor; `eventPassed` lo calcula el cliente** | `suggestDone` depende solo de los datos, igual que `suggestDiscard`. "Ya pasó" depende de la hora actual: calculado en el servidor quedaría obsoleto en una respuesta cacheada por el Service Worker; el cliente ya conoce la zona horaria | Confirmada | US-46, US-49 |

---

# 2. Convenciones

## 2.1 Base URL y transporte

- **Base:** `https://api.nudgee.app/v1` (`nudgee.app` es un dominio de ejemplo; el real se define en Terraform).
- Solo HTTPS con TLS 1.2+ (NFR-05). JSON en UTF-8.
- Fechas-hora en ISO-8601 UTC (`2026-10-13T15:00:00Z`); fechas locales del usuario como `YYYY-MM-DD` (`scheduledFor` y `details.eventDate`); horas locales como `HH:mm` (`details.eventTime`).
- Nombres de campos en `camelCase`, iguales a los del modelo de datos.

## 2.2 Headers comunes

| Header | Dirección | Uso |
| --- | --- | --- |
| `Authorization: Bearer {accessToken}` | Request | Obligatorio en todo excepto `GET /v1/health`. *Access token* de Cognito validado por el *authorizer* JWT de API Gateway; el `userId` siempre es el `sub` (NFR-05) |
| `Content-Type: application/json` | Request | En toda petición con body |
| `If-Match: "{version}"` | Request | Obligatorio en escrituras sobre un ítem (excepto el checklist, D-03) |
| `X-Correlation-Id: {ulid}` | Request (opcional) / Response (siempre) | Si el cliente no lo manda, la API genera uno. Se propaga a SQS, worker, Scheduler y push (NFR-10) |
| `ETag: "{version}"` | Response | En toda respuesta que devuelve un ítem |
| `Location` | Response | En `202` de `POST /v1/items` |
| `Retry-After: {segundos}` | Response | En `429` (NFR-07) |

**CORS:** si la API vive en un subdominio distinto al de la PWA, la configuración de API Gateway debe permitir los headers `Authorization`, `Content-Type`, `If-Match` y `X-Correlation-Id`, y exponer `ETag`, `Location`, `Retry-After` y `X-Correlation-Id` (`Access-Control-Expose-Headers`); si no, el navegador oculta el `ETag` y el *locking* no funciona.

## 2.3 Recurso `Item`

Es la única representación de un ítem: la usan el listado, el detalle y las respuestas de todas las acciones. No incluye atributos internos (`PK`, `SK`, `GSI1*`, `entityType`, `userId`, `aiOriginal`, `correlationId` ni la copia de primer nivel de `eventDate`, que existe solo para GSI1; Modelo D-10).

```json
{
  "videoId": "dQw4w9WgXcQ",
  "sourceUrl": "https://www.youtube.com/shorts/dQw4w9WgXcQ",
  "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "status": "PENDING",
  "category": "RECIPE",
  "title": "Pasta cremosa de un solo sartén",
  "summary": "Pasta con ajo, crema y parmesano lista en 20 minutos.",
  "details": {
    "ingredients": [
      { "id": "i1", "text": "250 g de pasta corta" },
      { "id": "i2", "text": "2 dientes de ajo" },
      { "id": "i3", "text": "200 ml de crema" }
    ],
    "steps": [
      "Cuece la pasta en agua con sal.",
      "Sofríe el ajo y agrega la crema.",
      "Mezcla la pasta con la salsa."
    ],
    "prepTime": 20
  },
  "checklist": { "i1": true, "i2": false, "i3": false },
  "confidence": 0.92,
  "dataSource": "AI",
  "analysisSource": "GEMINI",
  "analysisError": null,
  "savedAt": "2026-10-10T18:02:11Z",
  "readyAt": "2026-10-10T18:02:29Z",
  "statusUpdatedAt": "2026-10-10T18:02:29Z",
  "snoozeUntil": null,
  "scheduledFor": null,
  "snoozeCount": 0,
  "suggestDiscard": false,
  "suggestDone": false,
  "notifyCount": 1,
  "lastNotifiedAt": "2026-10-12T15:01:40Z",
  "expiresAt": null,
  "version": 3
}
```

| Campo | Notas |
| --- | --- |
| `category`, `title`, `summary`, `details`, `confidence`, `dataSource`, `analysisSource`, `readyAt` | `null` en `PROCESSING` y en `NEEDS_INPUT` sin datos |
| `category` | `RECIPE`, `ROUTINE`, `TUTORIAL`, `MOVIE_SERIES`, `PLACE`, `BOOK`, `MUSIC`, `PODCAST`, `EVENT`, `OTHER` |
| `details` | Forma según la categoría (RF §3.1, Modelo §3.6); ausente/`null` en `OTHER` |
| `checklist` | En categorías con elementos marcables o con lista; `{}` si no hay marcas. No existe en `EVENT` ni en `OTHER` |
| `analysisSource` | `GEMINI`, `CACHE` o `null` (si los datos vinieron del formulario) |
| `analysisError` | Solo en `NEEDS_INPUT`: `AI_ERROR`, `INVALID_OUTPUT`, `RETRIES_EXHAUSTED`, `VIDEO_UNAVAILABLE` |
| `suggestDiscard` | Derivado: `snoozeCount >= 3` (US-21) |
| `suggestDone` | Derivado: `true` en categorías con lista cuando todas las entradas están marcadas (US-46, API-16). El estado "ya pasó" de un evento lo calcula el cliente con `details.eventDate` y su zona horaria |
| `expiresAt` | Solo en `DISCARDED`. En la API es ISO-8601 (en DynamoDB es epoch); la UI calcula "Se eliminará en X días" (US-43) |
| `version` | Igual al `ETag` sin comillas |

**Ejemplos por estado** (solo los campos que difieren):

```jsx
// PROCESSING — recién guardado
{ "videoId": "aB3dE5fG7hJ", "status": "PROCESSING", "category": null, "title": null, "summary": null,
  "details": null, "dataSource": null, "readyAt": null, "version": 1 }

// NEEDS_INPUT — el análisis falló
{ "videoId": "aB3dE5fG7hJ", "status": "NEEDS_INPUT", "category": null, "analysisError": "RETRIES_EXHAUSTED",
  "dataSource": null, "version": 2 }

// DISCARDED
{ "videoId": "dQw4w9WgXcQ", "status": "DISCARDED", "expiresAt": "2026-11-12T18:20:00Z", "version": 5 }

// PENDING — lista
{ "videoId": "kL9mN1pQ3rS", "status": "PENDING", "category": "MOVIE_SERIES",
  "title": "5 películas de terror para Halloween",
  "details": { "entries": [
    { "id": "e1", "title": "El conjuro", "mediaType": "MOVIE", "year": 2013 },
    { "id": "e2", "title": "Hereditary", "mediaType": "MOVIE", "year": 2018 } ] },
  "checklist": { "e1": true }, "suggestDone": false, "analysisSource": "CACHE", "version": 2 }

// PENDING — evento
{ "videoId": "pQ7rS9tU1vW", "status": "PENDING", "category": "EVENT",
  "title": "Festival de jazz en el centro",
  "details": { "name": "Festival de Jazz GDL", "eventDate": "2026-11-08", "eventTime": "18:00",
               "cityOrAddress": "Guadalajara, Jal." },
  "checklist": {}, "version": 2 }
```

## 2.4 Formato de error (RFC 9457)

```json
{
  "type": "https://nudgee.app/errors/invalid-state-transition",
  "title": "Action not allowed in the current status",
  "status": 409,
  "detail": "Item dQw4w9WgXcQ is DONE; 'snooze' requires PENDING.",
  "instance": "/v1/items/dQw4w9WgXcQ/snooze",
  "code": "INVALID_STATE_TRANSITION",
  "correlationId": "01JA8Z3K5X2V7Q9R4T6Y8W0E1M"
}
```

- Header: `Content-Type: application/problem+json`.
- `code` es estable y es lo que usa la PWA para elegir el mensaje en español; `title` y `detail` son para desarrolladores y nunca incluyen PII (NFR-08).
- Errores de validación agregan `errors[]` con un *JSON Pointer* por campo:

```json
{
  "type": "https://nudgee.app/errors/validation-error",
  "title": "Request validation failed",
  "status": 400,
  "code": "VALIDATION_ERROR",
  "correlationId": "01JA8Z3K5X2V7Q9R4T6Y8W0E1M",
  "errors": [
    { "pointer": "/details/ingredients/0/text", "code": "REQUIRED", "message": "must not be empty" },
    { "pointer": "/title", "code": "MAX_LENGTH", "message": "must be at most 120 characters" }
  ]
}
```

## 2.5 Catálogo de errores

| HTTP | `code` | Cuándo | Mensaje sugerido en la UI |
| --- | --- | --- | --- |
| 400 | `INVALID_JSON` | Body no es JSON válido | "Algo salió mal. Intenta de nuevo." |
| 400 | `VALIDATION_ERROR` | Body, query o parámetro de ruta no cumple el contrato o el JSON Schema de la categoría | Mensaje por campo |
| 400 | `INVALID_URL` | El link no es un YouTube Shorts válido (US-06) | "Ese link no es un YouTube Short. Revisa y vuelve a pegarlo." |
| 401 | *(del authorizer)* | Token ausente, inválido o expirado. Lo emite API Gateway (`{"message":"Unauthorized"}`) | Refrescar token; si falla, volver al login |
| 404 | `ITEM_NOT_FOUND` | El ítem no existe, es de otro usuario o su `expiresAt` ya venció (no se distingue, NFR-05) | "Este video ya no está en tu biblioteca." |
| 404 | `NOTIFICATION_NOT_FOUND` | El `slotKey` no existe para el usuario | — (silencioso) |
| 409 | `DUPLICATE_ITEM` | El video ya está guardado (US-07) | "Ya guardaste este video." + botón "Ver" / "Restaurar" |
| 409 | `INVALID_STATE_TRANSITION` | La acción no está permitida en el estado actual (RF §4.4, incluye editar en `PROCESSING`, US-34) | "Esta acción ya no está disponible." + refrescar tarjeta |
| 412 | `VERSION_MISMATCH` | `If-Match` no coincide con la versión actual | "El ítem cambió en otro dispositivo. Revisa los cambios." |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 32 KB | — |
| 428 | `PRECONDITION_REQUIRED` | Falta `If-Match` en una escritura que lo exige | — (error de programación) |
| 429 | `QUOTA_EXCEEDED` | Cuota por usuario (30/h, 100/día) (NFR-07) | "Llegaste al límite de guardados. Intenta de nuevo en X min." |
| 429 | *(de API Gateway)* | *Throttling* del stage | "Hay mucho tráfico. Intenta en unos segundos." |
| 500 | `INTERNAL_ERROR` | Error no controlado | "Algo salió mal. Intenta de nuevo." |
| 503 | `SERVICE_UNAVAILABLE` | Dependencia crítica caída (DynamoDB o SQS) | "Servicio no disponible. Intenta en un momento." |

Los `409`, `412` y `429` de la API traen extensiones adicionales (ver cada endpoint). Para distinguir `409` de `412` sin una lectura extra, las escrituras condicionales usan `ReturnValuesOnConditionCheckFailure = ALL_OLD`.

**Errores comunes** (aplican a todos los endpoints de ítems y no se repiten abajo): `401`, `404 ITEM_NOT_FOUND`, `500`, `503`. Toda escritura con `If-Match` además puede responder `412` y `428`.

---

# 3. Resumen de endpoints

| # | Método y ruta | Descripción | `If-Match` | Trazabilidad |
| --- | --- | --- | --- | --- |
| E-01 | `GET /v1/health` | Salud del servicio (sin auth) | — | NFR-09, NFR-11 |
| E-02 | `GET /v1/config` | Configuración pública del cliente | — | API-10 |
| E-03 | `GET /v1/me` | Perfil y estado de recordatorios | — | US-01, US-35 |
| E-04 | `PATCH /v1/me` | Actualizar zona horaria / locale | — | US-37, AP-19 |
| E-05 | `POST /v1/items` | Guardar un link | — | US-04–US-07, T-01, AP-02 |
| E-06 | `GET /v1/items` | Listar biblioteca / polling por IDs | — | US-09, US-11–US-14, AP-03, AP-20 |
| E-07 | `GET /v1/items/{videoId}` | Ver tarjeta | — | US-16, US-38, AP-04 |
| E-08 | `PATCH /v1/items/{videoId}` | Editar ítem | Sí | US-31–US-34, AP-07 |
| E-09 | `POST /v1/items/{videoId}/submit-form` | Llenar formulario | Sí | US-10, T-04 |
| E-10 | `POST /v1/items/{videoId}/done` | Marcar hecho | Sí | US-17, T-05 |
| E-11 | `POST /v1/items/{videoId}/undo-done` | Deshacer hecho | Sí | US-18, T-06 |
| E-12 | `POST /v1/items/{videoId}/snooze` | Posponer | Sí | US-19, US-21 |
| E-13 | `POST /v1/items/{videoId}/reschedule` | Reprogramar | Sí | US-20, US-40 |
| E-14 | `POST /v1/items/{videoId}/discard` | Descartar | Sí | US-22, T-09 |
| E-15 | `POST /v1/items/{videoId}/restore` | Restaurar | Sí | US-23, T-10 |
| E-16 | `POST /v1/items/{videoId}/reactivate` | Reactivar dormido | Sí | US-25, T-08 |
| E-17 | `DELETE /v1/items/{videoId}` | Eliminar definitivo | Sí | US-24, T-11, AP-09 |
| E-18 | `PATCH /v1/items/{videoId}/checklist` | Marcar elementos o entradas | No (D-03) | US-26, US-45, AP-08 |
| E-19 | `POST /v1/notifications/{slotKey}/open` | Registrar apertura desde push | — | US-38, D-04, AP-14 |
| E-20 | `POST /v1/push-subscriptions` | Registrar suscripción push | — | US-35, AP-10 |
| E-21 | `DELETE /v1/push-subscriptions/{subscriptionId}` | Quitar suscripción push | — | US-03, AP-11 |

**Parámetros de ruta**

| Parámetro | Formato | Si no cumple |
| --- | --- | --- |
| `videoId` | `^[A-Za-z0-9_-]{11}$` | `400 VALIDATION_ERROR` |
| `slotKey` | `^\d{4}-\d{2}-\d{2}T\d{2}$` (ej. `2026-10-13T09`) | `400 VALIDATION_ERROR` |
| `subscriptionId` | `^[a-f0-9]{64}$` (SHA-256 hex del `endpoint`) | `400 VALIDATION_ERROR` |

---

# 4. Sistema y perfil

## E-01 · Salud del servicio

```
GET /v1/health
```

```
-> 200 OK
Content-Type: application/json

{ "status": "ok", "version": "1.0.0", "time": "2026-10-13T15:00:00Z" }
```

Sin autenticación. Lo usan el *smoke test* tras `terraform apply` y k6. No revisa dependencias (para no exponer información interna).

---

## E-02 · Configuración del cliente (API-10)

```
GET /v1/config
Authorization: Bearer {accessToken}
```

```
-> 200 OK
Content-Type: application/json
Cache-Control: private, max-age=3600

{
  "vapidPublicKey": "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  "reminderSlots": ["09:00", "14:00", "19:00"],
  "snoozeOptions": [1, 3, 5],
  "snoozeUnit": "DAY",
  "discardRetentionDays": 30,
  "pollingIntervalMs": 4000,
  "pollingMaxDurationMs": 120000
}
```

En la demo (NFR-11) `snoozeUnit` puede ser `"MINUTE"` y la UI adapta la etiqueta.

---

## E-03 · Ver perfil

```
GET /v1/me
Authorization: Bearer {accessToken}
```

```
-> 200 OK
Content-Type: application/json

{
  "userId": "a1b2c3d4-0000-4000-8000-000000000001",
  "email": "sara@example.com",
  "name": "Sara Aranda",
  "timezone": "America/Mexico_City",
  "locale": "es-MX",
  "scheduleState": "ACTIVE",
  "subscriptionCount": 2,
  "createdAt": "2026-10-01T16:00:00Z"
}
```

```
-> 404 Not Found     (el trigger de Cognito aún no creó el perfil; no debería pasar)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/profile-not-found", "title": "Profile not found", "status": 404,
  "code": "PROFILE_NOT_FOUND", "correlationId": "01JA8Z..." }
```

La PWA decide si muestra el banner de US-35 con `pushManager.getSubscription()` del dispositivo, no con `subscriptionCount` (que cuenta todos los dispositivos).

---

## E-04 · Actualizar zona horaria / locale

La PWA lo llama al iniciar si `Intl.DateTimeFormat().resolvedOptions().timeZone` difiere del perfil. Si cambia la zona y hay schedule, la API actualiza su `ScheduleExpressionTimezone`.

```
PATCH /v1/me
Authorization: Bearer {accessToken}
Content-Type: application/json

{ "timezone": "America/Mexico_City", "locale": "es-MX" }
```

```
-> 200 OK
Content-Type: application/json

{ ...perfil completo, igual que E-03 }
```

```
-> 400 Bad Request   (zona horaria no IANA o locale no soportado)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/validation-error", "title": "Request validation failed", "status": 400,
  "code": "VALIDATION_ERROR", "correlationId": "01JA8Z...",
  "errors": [ { "pointer": "/timezone", "code": "INVALID_TIMEZONE", "message": "must be a valid IANA time zone" } ] }
```

Sin `If-Match`: el último en escribir gana (solo son preferencias del dispositivo).

---

# 5. Ítems

## E-05 · Guardar un link

**Reglas**

1. Se aceptan solo URLs `https://` de `youtube.com`, `www.youtube.com` o `m.youtube.com` con ruta `/shorts/{videoId}`; se ignoran *query string* y fragmento. Máx. 2,048 caracteres.
2. Se guarda la URL canónica reconstruida, nunca la pegada (NFR-06).
3. Orden: validar URL → deduplicar (Redis `SET NX` + `PutItem` condicional) → cuota (Redis, *fallback* `QUOTA_COUNTER`) → encolar en **SQS FIFO** con `MessageGroupId = videoId` y `MessageDeduplicationId = userId#videoId` → `202` (p95 ≤ 300 ms, NFR-01). Agrupar por video permite que la caché global evite análisis repetidos (Modelo D-09). Duplicados e inválidos no consumen cuota (API-14).
4. Un reintento de red del mismo POST recibe `409` con `status: PROCESSING`; la PWA lo trata como éxito.

```
POST /v1/items
Authorization: Bearer {accessToken}
Content-Type: application/json
X-Correlation-Id: 01JA8Z3K5X2V7Q9R4T6Y8W0E1M

{ "url": "https://youtube.com/shorts/aB3dE5fG7hJ?si=Xy12AbCd" }
```

```
-> 202 Accepted
Content-Type: application/json
Location: /v1/items/aB3dE5fG7hJ
ETag: "1"
X-Correlation-Id: 01JA8Z3K5X2V7Q9R4T6Y8W0E1M

{
  "videoId": "aB3dE5fG7hJ",
  "sourceUrl": "https://www.youtube.com/shorts/aB3dE5fG7hJ",
  "thumbnailUrl": "https://i.ytimg.com/vi/aB3dE5fG7hJ/hqdefault.jpg",
  "status": "PROCESSING",
  "category": null, "title": null, "summary": null, "details": null, "checklist": {},
  "confidence": null, "dataSource": null, "analysisSource": null, "analysisError": null,
  "savedAt": "2026-10-13T15:00:00Z", "readyAt": null, "statusUpdatedAt": "2026-10-13T15:00:00Z",
  "snoozeUntil": null, "scheduledFor": null, "snoozeCount": 0, "suggestDiscard": false, "suggestDone": false,
  "notifyCount": 0, "lastNotifiedAt": null, "expiresAt": null,
  "version": 1
}
```

```
-> 400 Bad Request   (no es un YouTube Short — US-06)
Content-Type: application/problem+json

{
  "type": "https://nudgee.app/errors/invalid-url",
  "title": "Invalid YouTube Shorts URL",
  "status": 400,
  "detail": "Only https://youtube.com/shorts/{videoId} links are supported.",
  "code": "INVALID_URL",
  "correlationId": "01JA8Z3K5X2V7Q9R4T6Y8W0E1M"
}
```

```
-> 409 Conflict      (ya guardado — US-07)
Content-Type: application/problem+json

{
  "type": "https://nudgee.app/errors/duplicate-item",
  "title": "Video already saved",
  "status": 409,
  "code": "DUPLICATE_ITEM",
  "correlationId": "01JA8Z3K5X2V7Q9R4T6Y8W0E1M",
  "existing": { "videoId": "aB3dE5fG7hJ", "status": "DISCARDED", "title": "Tacos de canasta" }
}
```

La UI: si `existing.status` es `DISCARDED` ofrece "Restaurar" (E-15); en otro caso, "Ver tarjeta" (E-07).

```
-> 429 Too Many Requests   (cuota por usuario — US-04, NFR-07)
Content-Type: application/problem+json
Retry-After: 1260

{
  "type": "https://nudgee.app/errors/quota-exceeded",
  "title": "Save quota exceeded",
  "status": 429,
  "code": "QUOTA_EXCEEDED",
  "correlationId": "01JA8Z3K5X2V7Q9R4T6Y8W0E1M",
  "window": "HOUR",
  "limit": 30,
  "retryAfterSeconds": 1260
}
```

```
-> 503 Service Unavailable   (no se pudo encolar en SQS; el ítem no queda guardado)
Content-Type: application/problem+json
Retry-After: 5

{ "type": "https://nudgee.app/errors/service-unavailable", "title": "Service unavailable", "status": 503,
  "code": "SERVICE_UNAVAILABLE", "correlationId": "01JA8Z..." }
```

Si falla el envío a SQS después del `PutItem`, la Lambda borra el ítem (compensación) antes de responder `503`, para cumplir "ningún `202` se pierde" (NFR-03). Si Redis no responde, no hay error: se usa el *fallback* en DynamoDB.

---

## E-06 · Listar biblioteca / polling

**Modo listado** (US-11–US-14)

| Query | Tipo | Default | Notas |
| --- | --- | --- | --- |
| `limit` | entero 1–100 | 50 | Ítems por página |
| `cursor` | string opaco | — | `nextCursor` de la página anterior |

```
GET /v1/items?limit=50
Authorization: Bearer {accessToken}
```

```
-> 200 OK
Content-Type: application/json

{
  "items": [
    { ...Item, "videoId": "aB3dE5fG7hJ", "status": "PROCESSING" },
    { ...Item, "videoId": "dQw4w9WgXcQ", "status": "PENDING" }
  ],
  "nextCursor": "eyJTSyI6IklURU0jZFF3NHc5V2dYY1EifQ"
}
```

```
-> 200 OK            (última página o biblioteca vacía)
Content-Type: application/json

{ "items": [], "nextCursor": null }
```

```
-> 400 Bad Request   (cursor manipulado, limit fuera de rango o ids + cursor juntos)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/validation-error", "title": "Request validation failed", "status": 400,
  "code": "VALIDATION_ERROR", "correlationId": "01JA8Z...",
  "errors": [ { "pointer": "/query/cursor", "code": "INVALID_CURSOR", "message": "cursor is not valid" } ] }
```

- Devuelve todos los estados; excluye los `DISCARDED` con `expiresAt` vencido (el TTL borra con retraso).
- El orden **no** es cronológico (API-12): el cliente ordena por `savedAt` y filtra por categoría/estado y busca por `title`/`summary` en local.
- El cursor es el `LastEvaluatedKey` codificado en base64url; el servidor lo valida y siempre reconstruye `PK` desde el token, así que no sirve para leer datos de otro usuario.

**Modo polling** (US-09)

| Query | Tipo | Notas |
| --- | --- | --- |
| `ids` | lista separada por comas, 1–25 `videoId` | Excluyente con `limit`/`cursor` |

```
GET /v1/items?ids=aB3dE5fG7hJ,kL9mN1pQ3rS
Authorization: Bearer {accessToken}
```

```
-> 200 OK
Content-Type: application/json

{
  "items": [
    { ...Item, "videoId": "aB3dE5fG7hJ", "status": "PENDING", "category": "PLACE", "version": 2 },
    { ...Item, "videoId": "kL9mN1pQ3rS", "status": "PROCESSING", "version": 1 }
  ],
  "nextCursor": null
}
```

Los `videoId` que no existen simplemente no aparecen (no es error). La PWA repite cada `pollingIntervalMs` solo con los que siguen en `PROCESSING` y se detiene cuando no queda ninguno o tras `pollingMaxDurationMs` (US-09).

---

## E-07 · Ver tarjeta

```
GET /v1/items/dQw4w9WgXcQ
Authorization: Bearer {accessToken}
```

```
-> 200 OK
Content-Type: application/json
ETag: "3"

{ ...Item completo (§2.3) }
```

```
-> 404 Not Found
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/item-not-found", "title": "Item not found", "status": 404,
  "code": "ITEM_NOT_FOUND", "instance": "/v1/items/dQw4w9WgXcQ", "correlationId": "01JA8Z..." }
```

---

## E-08 · Editar ítem

**Reglas**

- Solo en `PENDING` y `DORMANT` (RF §3.2, US-34).
- Campos editables: `title`, `summary`, `category`, `details`. Los campos ausentes no cambian. `details`, si viene, **reemplaza el objeto completo** (no se mezcla).
- Si cambia `category`, `details` es obligatorio y debe cumplir el schema de la nueva categoría (en `OTHER` debe omitirse o ser `null`); el checklist se vacía.
- IDs: los elementos marcables (`ingredients`, `exercises`, `materials`) y las entradas (`entries`) existentes conservan su `id`; los nuevos se mandan sin `id` y el servidor lo asigna (API-15). El checklist conserva las marcas de los `id` que sigan existiendo (D-03).
- Límites preliminares (se formalizan en los JSON Schemas): `title` 1–120 caracteres; `summary` ≤ 500; hasta 50 elementos marcables de 1–200 caracteres; hasta 30 `steps` de 1–500 caracteres; `entries` de 1 a 20; `eventDate` `YYYY-MM-DD` válido (se permite una fecha pasada); `eventTime` `HH:mm`.

```
PATCH /v1/items/dQw4w9WgXcQ
Authorization: Bearer {accessToken}
Content-Type: application/json
If-Match: "3"

{
  "title": "Pasta cremosa con champiñones",
  "details": {
    "ingredients": [
      { "id": "i1", "text": "250 g de pasta corta" },
      { "id": "i3", "text": "200 ml de crema" },
      { "text": "150 g de champiñones" }
    ],
    "prepTime": 25
  }
}
```

```
-> 200 OK
Content-Type: application/json
ETag: "4"

{
  ...Item,
  "title": "Pasta cremosa con champiñones",
  "details": {
    "ingredients": [
      { "id": "i1", "text": "250 g de pasta corta" },
      { "id": "i3", "text": "200 ml de crema" },
      { "id": "i4", "text": "150 g de champiñones" }
    ],
    "prepTime": 25
  },
  "checklist": { "i1": true, "i3": false },
  "version": 4
}
```

```
-> 400 Bad Request   (no cumple el JSON Schema de la categoría)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/validation-error", "title": "Request validation failed", "status": 400,
  "code": "VALIDATION_ERROR", "correlationId": "01JA8Z...",
  "errors": [
    { "pointer": "/details", "code": "REQUIRED", "message": "details is required when category changes" }
  ] }
```

```
-> 409 Conflict      (el ítem está en PROCESSING, DONE, etc. — US-34)
Content-Type: application/problem+json

{
  "type": "https://nudgee.app/errors/invalid-state-transition",
  "title": "Action not allowed in the current status",
  "status": 409,
  "code": "INVALID_STATE_TRANSITION",
  "correlationId": "01JA8Z...",
  "action": "edit",
  "currentStatus": "PROCESSING",
  "allowedStatuses": ["PENDING", "DORMANT"]
}
```

```
-> 412 Precondition Failed   (lo editaron en otro dispositivo)
Content-Type: application/problem+json
ETag: "5"

{
  "type": "https://nudgee.app/errors/version-mismatch",
  "title": "Item was modified",
  "status": 412,
  "code": "VERSION_MISMATCH",
  "correlationId": "01JA8Z...",
  "currentVersion": 5
}
```

```
-> 428 Precondition Required   (falta If-Match)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/precondition-required", "title": "If-Match header is required",
  "status": 428, "code": "PRECONDITION_REQUIRED", "correlationId": "01JA8Z..." }
```

**Ejemplo: agregar una película a una lista**

```
PATCH /v1/items/kL9mN1pQ3rS
Authorization: Bearer {accessToken}
Content-Type: application/json
If-Match: "2"

{ "details": { "entries": [
    { "id": "e1", "title": "El conjuro", "mediaType": "MOVIE", "year": 2013 },
    { "id": "e2", "title": "Hereditary", "mediaType": "MOVIE", "year": 2018 },
    { "title": "Siniestro", "mediaType": "MOVIE", "year": 2012 } ] } }
```

```
-> 200 OK
Content-Type: application/json
ETag: "3"

{ ...Item, "details": { "entries": [ …, { "id": "e3", "title": "Siniestro", "mediaType": "MOVIE", "year": 2012 } ] },
  "checklist": { "e1": true }, "suggestDone": false, "version": 3 }
```

> Los `409`, `412` y `428` de E-09…E-17 tienen la misma forma; solo cambian `action`, `currentStatus` y `allowedStatuses`.
> 

---

## E-09 · Llenar formulario (`NEEDS_INPUT → PENDING`)

```
POST /v1/items/aB3dE5fG7hJ/submit-form
Authorization: Bearer {accessToken}
Content-Type: application/json
If-Match: "2"

{
  "category": "PLACE",
  "title": "Tacos El Güero",
  "summary": "Taquería de canasta recomendada en el centro.",
  "details": { "name": "Tacos El Güero", "cityOrAddress": "Guadalajara, Jal." }
}
```

```
-> 200 OK
Content-Type: application/json
ETag: "3"

{ ...Item, "status": "PENDING", "category": "PLACE", "title": "Tacos El Güero",
  "dataSource": "USER_FORM", "analysisError": null, "readyAt": "2026-10-13T15:04:10Z", "version": 3 }
```

```
-> 400 Bad Request   (falta category/title o details no cumple el schema)
-> 409 Conflict      (action: "submit-form", allowedStatuses: ["NEEDS_INPUT"])
-> 412 / 428         (ver E-08)
```

`category` y `title` son obligatorios; `summary` opcional. Aplican las mismas reglas de IDs y límites que en E-08.

---

## E-10 · Marcar hecho (`PENDING → DONE`)

```
POST /v1/items/dQw4w9WgXcQ/done
Authorization: Bearer {accessToken}
If-Match: "4"
```

```
-> 200 OK
Content-Type: application/json
ETag: "5"

{ ...Item, "status": "DONE", "statusUpdatedAt": "2026-10-13T20:10:00Z", "version": 5 }
```

```
-> 409 Conflict      (action: "done", allowedStatuses: ["PENDING"])
-> 412 / 428
```

Sale de GSI1 (`REMOVE GSI1PK, GSI1SK`). Si el usuario se queda sin pendientes, se pausa su schedule (RF §5).

---

## E-11 · Deshacer hecho (`DONE → PENDING`)

```
POST /v1/items/dQw4w9WgXcQ/undo-done
Authorization: Bearer {accessToken}
If-Match: "5"
```

```
-> 200 OK
Content-Type: application/json
ETag: "6"

{ ...Item, "status": "PENDING", "version": 6 }
```

```
-> 409 Conflict      (action: "undo-done", allowedStatuses: ["DONE"])
-> 412 / 428
```

Vuelve a GSI1 y reanuda el schedule si estaba pausado por falta de pendientes.

---

## E-12 · Posponer

```
POST /v1/items/dQw4w9WgXcQ/snooze
Authorization: Bearer {accessToken}
Content-Type: application/json
If-Match: "6"

{ "days": 3 }
```

```
-> 200 OK
Content-Type: application/json
ETag: "7"

{ ...Item, "status": "PENDING", "snoozeUntil": "2026-10-16T20:15:00Z", "scheduledFor": null,
  "snoozeCount": 3, "suggestDiscard": true, "version": 7 }
```

```
-> 400 Bad Request   (days no está en snoozeOptions)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/validation-error", "title": "Request validation failed", "status": 400,
  "code": "VALIDATION_ERROR", "correlationId": "01JA8Z...",
  "errors": [ { "pointer": "/days", "code": "ENUM", "message": "must be one of 1, 3, 5" } ] }
```

```
-> 409 Conflict      (action: "snooze", allowedStatuses: ["PENDING"])
-> 412 / 428
```

- `snoozeUntil = ahora + days × snoozeUnit` (configurable, NFR-11). `snoozeCount` sube hasta 3.
- Con `suggestDiscard: true` la tarjeta sugiere descartar (US-21); no es bloqueante.
- Borra `scheduledFor` (API-11). No cuenta como ignorado.

---

## E-13 · Reprogramar

```
POST /v1/items/dQw4w9WgXcQ/reschedule
Authorization: Bearer {accessToken}
Content-Type: application/json
If-Match: "7"

{ "date": "2026-10-18" }
```

```
-> 200 OK
Content-Type: application/json
ETag: "8"

{ ...Item, "status": "PENDING", "scheduledFor": "2026-10-18", "snoozeUntil": null, "version": 8 }
```

```
-> 400 Bad Request   (fecha mal formada, en el pasado o a más de 365 días, según la zona del usuario)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/validation-error", "title": "Request validation failed", "status": 400,
  "code": "VALIDATION_ERROR", "correlationId": "01JA8Z...",
  "errors": [ { "pointer": "/date", "code": "DATE_IN_PAST", "message": "must be today or later" } ] }
```

```
-> 409 Conflict      (action: "reschedule", allowedStatuses: ["PENDING"])
-> 412 / 428
```

`date` es fecha local (solo día, US-20); "hoy" se calcula con `USER.timezone`. Borra `snoozeUntil` (API-11).

---

## E-14 · Descartar (`PENDING | NEEDS_INPUT | DORMANT → DISCARDED`)

```
POST /v1/items/dQw4w9WgXcQ/discard
Authorization: Bearer {accessToken}
If-Match: "8"
```

```
-> 200 OK
Content-Type: application/json
ETag: "9"

{ ...Item, "status": "DISCARDED", "expiresAt": "2026-11-12T20:20:00Z", "version": 9 }
```

```
-> 409 Conflict      (action: "discard", allowedStatuses: ["PENDING", "NEEDS_INPUT", "DORMANT"])
-> 412 / 428
```

`expiresAt = ahora + discardRetentionDays` (T-12, US-43). Sale de GSI1 si estaba en `PENDING`.

---

## E-15 · Restaurar (`DISCARDED → PENDING | NEEDS_INPUT`)

```
POST /v1/items/dQw4w9WgXcQ/restore
Authorization: Bearer {accessToken}
If-Match: "9"
```

```
-> 200 OK            (tenía datos: dataSource = AI | USER_FORM)
Content-Type: application/json
ETag: "10"

{ ...Item, "status": "PENDING", "expiresAt": null, "version": 10 }
```

```
-> 200 OK            (nunca tuvo datos: dataSource = null)
Content-Type: application/json
ETag: "10"

{ ...Item, "status": "NEEDS_INPUT", "expiresAt": null, "version": 10 }
```

```
-> 404 Not Found     (expiresAt ya venció aunque el TTL no lo haya borrado)
-> 409 Conflict      (action: "restore", allowedStatuses: ["DISCARDED"])
-> 412 / 428
```

Cancela el borrado automático (`REMOVE expiresAt`, US-43). `notifyCount` y `snoozeCount` vuelven a 0.

---

## E-16 · Reactivar dormido (`DORMANT → PENDING`)

```
POST /v1/items/dQw4w9WgXcQ/reactivate
Authorization: Bearer {accessToken}
If-Match: "10"
```

```
-> 200 OK
Content-Type: application/json
ETag: "11"

{ ...Item, "status": "PENDING", "notifyCount": 0, "version": 11 }
```

```
-> 409 Conflict      (action: "reactivate", allowedStatuses: ["DORMANT"])
-> 412 / 428
```

---

## E-17 · Eliminar definitivo (`DISCARDED → eliminado`)

La confirmación ("¿Eliminar para siempre?") es responsabilidad de la UI (US-24).

```
DELETE /v1/items/dQw4w9WgXcQ
Authorization: Bearer {accessToken}
If-Match: "9"
```

```
-> 204 No Content
```

```
-> 409 Conflict      (action: "delete", allowedStatuses: ["DISCARDED"])
-> 412 / 428
```

Un segundo `DELETE` del mismo ítem responde `404`; la PWA lo trata como éxito.

---

## E-18 · Marcar elementos o entradas

Actualiza solo las llaves enviadas (*merge*). No usa `If-Match` ni incrementa `version` (D-03), para que marcar en dos dispositivos no genere conflictos. Aplica a todas las categorías excepto `EVENT` y `OTHER`.

```
PATCH /v1/items/kL9mN1pQ3rS/checklist
Authorization: Bearer {accessToken}
Content-Type: application/json

{ "e2": true }
```

```
-> 200 OK
Content-Type: application/json

{ "videoId": "kL9mN1pQ3rS", "checklist": { "e1": true, "e2": true }, "suggestDone": true }
```

```
-> 400 Bad Request   (id inexistente o valor no booleano)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/validation-error", "title": "Request validation failed", "status": 400,
  "code": "VALIDATION_ERROR", "correlationId": "01JA8Z...",
  "errors": [ { "pointer": "/e9", "code": "UNKNOWN_CHECKLIST_ITEM", "message": "item e9 does not exist" } ] }
```

```
-> 409 Conflict      (EVENT u OTHER, o el ítem no está en PENDING/DORMANT)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/invalid-state-transition", "title": "Action not allowed in the current status",
  "status": 409, "code": "INVALID_STATE_TRANSITION", "correlationId": "01JA8Z...",
  "action": "checklist", "currentStatus": "DONE", "allowedStatuses": ["PENDING", "DORMANT"],
  "allowedCategories": ["RECIPE", "ROUTINE", "TUTORIAL", "MOVIE_SERIES", "PLACE", "BOOK", "MUSIC", "PODCAST"] }
```

`suggestDone` en la respuesta permite que la tarjeta muestre la sugerencia de US-46 en cuanto se marca la última entrada.

---

# 6. Recordatorios

## E-19 · Registrar apertura desde la push

La PWA lo llama al abrir la tarjeta desde una notificación (la URL de la push trae `slot`, ver §7). Idempotente.

```
POST /v1/notifications/2026-10-13T09/open
Authorization: Bearer {accessToken}
```

```
-> 204 No Content    (primera apertura: openedAt escrito y notifyCount del ítem = 0)
```

```
-> 204 No Content    (ya estaba abierta, o el ítem ya no está en PENDING: solo se registra openedAt)
```

```
-> 404 Not Found     (no existe ese slotKey para el usuario o ya expiró)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/notification-not-found", "title": "Notification not found",
  "status": 404, "code": "NOTIFICATION_NOT_FOUND", "correlationId": "01JA8Z..." }
```

La PWA ignora el `404` (no bloquea abrir la tarjeta). Implementación: `TransactWriteItems` de AP-14; si la condición del ítem (`status = PENDING`) falla, se reintenta solo con el `Update` de la notificación.

---

## E-20 · Registrar suscripción push

El body es el `PushSubscription.toJSON()` del navegador más una etiqueta de plataforma. *Upsert* por `subscriptionId = SHA-256(endpoint)`.

```
POST /v1/push-subscriptions
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "endpoint": "https://fcm.googleapis.com/fcm/send/cX9a...:APA91b...",
  "expirationTime": null,
  "keys": {
    "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    "auth": "tBHItJI5svbpez7KI4CCXg"
  },
  "platform": "Chrome Android"
}
```

```
-> 201 Created       (nueva suscripción)
Content-Type: application/json

{
  "subscriptionId": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "scheduleState": "ACTIVE"
}
```

```
-> 200 OK            (el mismo navegador ya estaba suscrito: se actualizan llaves y expirationTime)
Content-Type: application/json

{ "subscriptionId": "9f86d08...", "scheduleState": "ACTIVE" }
```

```
-> 400 Bad Request   (host del endpoint fuera de la lista blanca — API-13 — o llaves inválidas)
Content-Type: application/problem+json

{ "type": "https://nudgee.app/errors/validation-error", "title": "Request validation failed", "status": 400,
  "code": "VALIDATION_ERROR", "correlationId": "01JA8Z...",
  "errors": [ { "pointer": "/endpoint", "code": "UNSUPPORTED_PUSH_SERVICE", "message": "push service host is not allowed" } ] }
```

- Lista blanca inicial: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`.
- Efecto: crea el schedule `nudgee-{userId}` si no existe. `scheduleState` queda `ACTIVE` si hay pendientes, o `PAUSED` si no (RF §5).

---

## E-21 · Quitar suscripción push

Se llama al cerrar sesión (US-03) o si el usuario revoca el permiso. El cliente calcula `subscriptionId` como SHA-256 hex del `endpoint` (`crypto.subtle.digest`), igual que el servidor.

```
DELETE /v1/push-subscriptions/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
Authorization: Bearer {accessToken}
```

```
-> 204 No Content    (borrada, o no existía: idempotente)
```

Si era la última suscripción, `scheduleState = PAUSED` y se pausa el schedule.

---

# 7. Contrato del payload de Web Push

No es un endpoint HTTP de la API, pero es un contrato entre la Lambda despachadora y el Service Worker. Va cifrado (VAPID + `aes128gcm`) y debe pesar menos de 3 KB.

```json
{
  "v": 1,
  "type": "REMINDER",
  "slotKey": "2026-10-13T09",
  "videoId": "dQw4w9WgXcQ",
  "title": "¿Hoy la cocinas?",
  "body": "Pasta cremosa de un solo sartén",
  "icon": "/icons/icon-192.png",
  "url": "/items/dQw4w9WgXcQ?slot=2026-10-13T09",
  "correlationId": "01JA8Z3K5X2V7Q9R4T6Y8W0E1M"
}
```

- El Service Worker solo abre `url` si empieza con `/` (ruta del propio origen, RF §5, NFR-06).
- Al abrir la tarjeta con `?slot=`, la PWA llama a E-19 y después a E-07.
- Sin botones de acción (fuera del MVP).
- `title` y `body` los arma el despachador con plantillas por categoría en el `locale` del usuario, a partir del ítem que lee en AP-12. `{title}` se trunca a 120 caracteres para mantener el payload por debajo de 3 KB.

**Textos iniciales (es-MX, editables en los archivos de i18n)**

| Categoría | `title` | `body` |
| --- | --- | --- |
| `RECIPE` | ¿Hoy la cocinas? | `{title}` |
| `ROUTINE` | ¿Hoy la haces? | `{title}` |
| `TUTORIAL` | ¿Hoy lo intentas? | `{title}` |
| `MOVIE_SERIES` | ¿Hoy ves algo? | `{title}`; en listas, `{title} · Te faltan {pendientes} de {total}` |
| `PLACE` | ¿Hoy vas? | Igual que `MOVIE_SERIES` |
| `BOOK` | ¿Empiezas a leer? | Igual que `MOVIE_SERIES` |
| `MUSIC`, `PODCAST` | ¿Lo escuchas hoy? | Igual que `MOVIE_SERIES` |
| `EVENT` | Tu evento es el `{fecha}`; sin fecha: ¿Ya tienes plan? | `{title}` |
| `OTHER` | ¿Hoy es el día? | `{title}` |

---

# 8. Autenticación (Cognito, fuera de la API)

Estos endpoints los provee el dominio de Cognito (*Hosted UI*); la API solo valida el *access token*.

| Paso | Endpoint de Cognito | Notas | US |
| --- | --- | --- | --- |
| Login | `GET /oauth2/authorize?identity_provider=Google&response_type=code&code_challenge=…` | *Authorization Code*  • PKCE; scopes `openid email profile` (NFR-08) | US-01 |
| Tokens | `POST /oauth2/token` (`grant_type=authorization_code`) | Access token 60 min, refresh token 30 días | US-01, US-02 |
| Refrescar | `POST /oauth2/token` (`grant_type=refresh_token`) | Ante un `401` de la API, el cliente refresca una vez y reintenta | US-02 |
| Logout | `POST /oauth2/revoke` y luego `GET /logout` | Antes, la PWA llama a E-21 para no seguir enviando push a un dispositivo compartido | US-03 |

---

# 9. Cambios aplicados a otros documentos

Aplicados al confirmar las decisiones (v1.0).

| Documento | Cambio | Decisión |
| --- | --- | --- |
| RF v1.2 → v1.3 | §4.5: posponer borra `scheduledFor` y reprogramar borra `snoozeUntil` | API-11 |
| RF v1.2 → v1.3 | §4.3 T-10: restaurar reinicia `notifyCount` y `snoozeCount` | E-15 |
| Modelo v1.0 → v1.1 | AP-01 lo ejecuta un trigger *Post Authentication* de Cognito; agregar AP-19 (`PATCH /me`) y AP-20 (`BatchGetItem` del polling) | API-09, API-06 |
| Modelo v1.0 → v1.1 | §5 AP-03: aclarar que el orden de la paginación es por `videoId` y que el cliente ordena por `savedAt` | API-12 |
| NFR v1.1 → v1.2 | NFR-06: lista blanca de hosts de *push services* | API-13 |
| Modelo v1.2 | §8: el recurso `Item` expone `analysisSource` y `suggestDone`; la copia de primer nivel de `eventDate` queda interna *(aplicado en v1.1)* | API-16, D-10 |
| NFR v1.2 → v1.3 | Caché global y SQS FIFO; schedule group; métrica de aciertos de la caché *(aplicado)* | — |

---

# 10. Siguiente iteración (parte 2 del entregable #5)

1. `openapi.yaml` (OpenAPI 3.1) generado a partir de este documento, con `components/schemas` y `components/responses` reutilizables.
2. JSON Schemas para las 10 categorías (`RECIPE`, `ROUTINE`, `TUTORIAL`, `MOVIE_SERIES`, `PLACE`, `BOOK`, `MUSIC`, `PODCAST`, `EVENT`, `OTHER`), incluidas las formas con `entries[]` y los límites de E-08, compartidos por la validación del servidor, el formulario de `NEEDS_INPUT` y la salida estructurada de Gemini.