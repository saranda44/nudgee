# Requerimientos no funcionales (MVP)

| Campo | Valor |
| --- | --- |
| Producto | Nudgee |
| Documento | Requerimientos no funcionales, restricciones y supuestos del MVP |
| Versión | 1.3 |
| Fecha | 15 de octubre de 2026 |
| Responsable | Sara Aranda |
| Contexto | Proyecto final de *Sistemas Escalables* (ITESO) |
| Estado | Confirmado |
| Documentos relacionados | `Nudgee_Requerimientos_Funcionales_MVP.md` (v1.4), `Nudgee_Modelo_de_Datos.md` (v1.2), `Nudgee_Contratos_API.md` (v1.1) |

## Historial de cambios

| Versión | Cambios |
| --- | --- |
| 1.0 | Versión inicial confirmada |
| 1.1 | Alineación con el modelo de datos v1.0: §7 ya no menciona una tabla de suscripciones aparte (son registros de la tabla única); NFR-01 mide `savedAt → readyAt`, con los nombres de atributo del modelo |
| 1.2 | Alineación con los contratos de API v1.0: NFR-06 agrega la lista blanca de hosts de *push services* para las suscripciones (API-13) |
| 1.3 | Alineación con RF v1.4, Modelo v1.2 y API v1.1: caché global de análisis y SQS FIFO (NFR-01, NFR-02, NFR-03, §6); schedule group gestionado por Terraform (NFR-09); métrica de aciertos de la caché (NFR-10); `.ics` y nuevas plantillas de links (NFR-06); la caché no contiene PII (NFR-08); seed por categoría y reglas de eventos (NFR-11); filtros de 10 categorías y textos de push en i18n (NFR-13); justificación de Redis como optimización (NFR-14); supuesto S-08; nuevas limitaciones en §7 |

---

---

# 1. Enfoque

Los requerimientos se especifican en **dos niveles**:

| Nivel | Propósito |
| --- | --- |
| **MVP real** | Lo que debe cumplirse con los usuarios reales de la demo (decenas de personas) |
| **Escala de diseño** | Lo que la arquitectura debe soportar y se demuestra con pruebas de carga (k6) |

Cada RNF tiene un atributo de calidad, criterios de aceptación medibles y un método de verificación. Los detalles de implementación se documentan en la arquitectura, no aquí.

---

# 2. Supuestos de carga (escala de diseño)

| ID | Supuesto | Valor |
| --- | --- | --- |
| S-01 | Usuarios activos diarios | 10,000 |
| S-02 | Guardados por usuario al día | ~5 → **~50,000 análisis/día** |
| S-03 | Pico de guardados | ~30 guardados/s durante 5 min |
| S-04 | Recordatorios | Máx. 1 por usuario por franja → **≤ 10,000 push por franja** y ≤ 30,000 al día |
| S-05 | Franjas | 3 al día, en la hora local de cada usuario |
| S-06 | Duración de los videos | YouTube Shorts (hasta 3 min) |
| S-07 | Usuarios del MVP real | Decenas de usuarios del salón, instalación explicada de forma presencial |
| S-08 | Tasa de aciertos de la caché de análisis | **No se asume**: la capacidad se dimensiona con 0% de aciertos (peor caso) y la tasa real se mide (NFR-10) |

---

# 3. Restricciones

| ID | Restricción | Implicación |
| --- | --- | --- |
| C-01 | Despliegue en **AWS Academy Learner Lab** | Rol IAM fijo (`LabRole`), regiones y servicios limitados, sesiones que expiran (~4 h), créditos limitados |
| C-02 | **Infraestructura efímera con Terraform** | El entorno se construye y se destruye en cada sesión de laboratorio; en la presentación final se construye y después se destruye. Nada queda encendido al cerrar el lab |
| C-03 | Presupuesto de **hasta ~$50 USD/mes** (AWS + Gemini) | Servicios con costo base solo cuando están justificados |
| C-04 | IA: **Gemini Flash** con salida JSON Schema | La cuota de Gemini es el cuello de botella del procesamiento |
| C-05 | Fuente de contenido: **solo YouTube Shorts** | Gemini lee la URL directamente; no se descarga el video |
| C-06 | Stack AWS: CloudFront, S3, Cognito (Google SSO), API Gateway, Lambda, ElastiCache Redis, **SQS FIFO + DLQ FIFO**, DynamoDB, EventBridge Scheduler, X-Ray, CloudWatch | Definido por la materia y el diseño del proyecto |
| C-07 | Web Push en iOS requiere **Safari 16.4+ con la PWA instalada** en la pantalla de inicio | Ver US-36 |
| C-08 | Servicios por verificar en el Learner Lab: Cognito con Google como IdP, ElastiCache, ACM, EventBridge Scheduler (incluidos los *schedule groups*) y SQS FIFO | Si alguno no está disponible, se ajusta la arquitectura |

---

# 4. Requerimientos no funcionales

| ID | Atributo | Requirement | Criterios de aceptación | Verificación | US relacionadas |
| --- | --- | --- | --- | --- | --- |
| NFR-01 | Performance | The system responds quickly to user actions and analyzes videos in near real time. | Save returns `202` with p95 ≤ 300 ms and p99 ≤ 1 s · Reads p95 ≤ 500 ms · LCP ≤ 2.5 s on 4G, repeat load ≤ 1 s · AI analysis (`savedAt → readyAt`) p95 ≤ 30 s under nominal load · Analysis served from the global cache: `savedAt → readyAt` p95 ≤ 5 s | API Gateway `Latency` metric, k6, Lighthouse, timestamps in CloudWatch grouped by `analysisSource` | US-05, US-09, US-11 |
| NFR-02 | Scalability | The architecture absorbs the design load and bursts without errors. | Designed for 10k DAU (S-01) · 30 saves/s for 5 min with 0 errors 5xx · Backlog drains in ≤ 15 min · Worker concurrency capped so Gemini `429` errors stay < 1% · Capacity sized for a 0% cache hit rate (S-08) · FIFO throughput stays well below the 300 msg/s limit at 30 saves/s | k6 load test, SQS `ApproximateAgeOfOldestMessage`, Gemini error metric, k6 with unique videos | US-04, US-08 |
| NFR-03 | Data integrity | No accepted save is lost or duplicated. | 100% of `202` saves end in `PENDING` or `NEEDS_INPUT` within 15 min (retries with backoff → DLQ → `NEEDS_INPUT`) · 0 duplicates with 50 concurrent identical requests · If Redis is unavailable, ingest falls back to DynamoDB only (higher latency, no errors, no duplicates) · 50 different users saving the same video concurrently → 50 items, exactly 1 Gemini call, all 50 end in `PENDING` | Chaos test forcing Gemini failure, concurrency test, test with Redis disabled, cross-user concurrency test (Gemini calls counted in logs) | US-07, US-10 |
| NFR-04 | Reminder delivery | Reminders arrive on time and only to valid subscriptions. | Sent within 5 min after the slot time (p95) · Push `404/410` → subscription deleted in the same run | `scheduledAt` vs `sentAt` logs, unit test | US-37, US-38 |
| NFR-05 | Authentication & authorization | Only authenticated users access the API, and only their own data. | HTTPS (TLS 1.2+) on every request · Cognito JWT validated at API Gateway (access token 60 min, refresh token 30 days) · User ID always taken from the token (`sub`), never from the request | Integration test: user A cannot read or edit user B's items (0 leaks) | US-01, US-02, US-03 |
| NFR-06 | Input & output safety | User and AI input can never inject code or malicious links. | Links parsed and reduced to a `videoId`; only canonical URLs rebuilt by the app are stored · Every write (form, edit, AI output) validated server-side against the shared JSON Schema · Output escaped everywhere, `dangerouslySetInnerHTML` banned, strict CSP without `unsafe-inline` · Outbound links and thumbnails built only from fixed templates with encoded parameters · Push subscription endpoints accepted only from an allowlist of push service hosts (prevents SSRF) · New outbound templates (Google Calendar, web search for tickets) follow the same rule · `.ics` files generated client-side with fields escaped per RFC 5545 (no injected lines) | Unit tests with malicious payloads, ESLint in CI, XSS payloads in E2E tests, unit tests with malicious event names | US-04, US-06, US-10, US-26–US-33, US-47, US-48 |
| NFR-07 | Abuse protection | The API and the Gemini budget are protected from abuse. | Per-user quota: 30 saves/hour and 100/day → `429` with `Retry-After` · API Gateway stage throttling enabled | Test exceeding the quota | US-04 |
| NFR-08 | Privacy & data protection | Personal data is minimized and protected. | Only `sub`, email and name stored from Google (scopes `openid email profile`) · Encryption at rest (DynamoDB, S3, SSM SecureString) · No secrets in code; no email or name in logs (only `userId`) · The analysis cache stores no PII (derived only from a public video and a user-free prompt) | Configuration and log review before the demo, review of the cache record schema | US-01 |
| NFR-09 | Reproducible infrastructure | The full environment can be created and destroyed on demand. | `terraform apply` from an empty account ≤ 15 min with 0 manual console steps · `terraform destroy` leaves 0 resources tagged `project=nudgee` · Same domain, OAuth client and VAPID keys across rebuilds; secrets injected at apply time · Schedules created at runtime live in the Terraform-managed schedule group `nudgee-reminders`; `terraform destroy` deletes the group and its schedules | Timed apply/destroy, resource tag check, `aws scheduler list-schedules --group-name nudgee-reminders` returns empty after destroy | — |
| NFR-10 | Observability | Any request can be traced and failures are detected automatically. | Structured JSON logs with a `correlationId` propagated API → SQS → worker → Scheduler → push · X-Ray tracing on API, worker and dispatcher · CloudWatch dashboard (in Terraform) with p95/p99, queue depth and age, DLQ, Gemini errors and push success rate · Alarms: DLQ > 0, 5xx > 1% for 5 min, oldest message > 5 min · Dashboard includes the analysis cache hit rate (`analysisSource`) and the age of the oldest message in the FIFO queue | End-to-end trace shown in the demo, alarm test | — |
| NFR-11 | Testability & maintainability | The system can be tested and demonstrated quickly and safely. | Time rules configurable (slots, cooldown, max reminders, snooze days): full cycle "reminder → ignore ×3 → dormant" shown in ≤ 30 min · Seed script loads items in every status in ≤ 2 min without live Gemini calls · Reminder engine as pure functions with injectable clock, ≥ 80% coverage · CI on every PR (lint, tests, `terraform fmt/validate`) blocks merges on failure · k6 scripts versioned in the repo · Configurable time rules also include the upcoming-event window · Seed loads items of every category, including lists and past/upcoming events · Engine tests cover the event rules (past = not eligible, ≤ 7 days = priority) | Coverage report, CI pipeline, timed demo | US-37–US-42, US-49, US-50 |
| NFR-12 | Compatibility & installability | The app works on the target devices and can be installed. | Supported: Chrome Android (last 2 versions), Safari iOS 16.4+ installed on home screen, Chrome/Edge desktop; Firefox and Safari macOS best effort · Installable PWA (valid manifest + Service Worker) · Responsive from 360 to 1440 px without horizontal scroll · App shell and cached library open offline; actions show a clear "no connection" message | Manual device matrix, installability check, airplane-mode test | US-35, US-36 |
| NFR-13 | Usability & accessibility | Saving is frictionless and key flows are accessible. | Paste → confirmation in ≤ 2 interactions · WCAG 2.2 AA on login, paste link, library and item card · Touch targets ≥ 44 px · UI in Spanish (es-MX) with all strings externalized (i18n-ready); dates and times in the user's time zone · Category filters (10) usable at 360 px without breaking the layout (horizontal scroll) · Push texts per category externalized in i18n | axe (0 critical), Lighthouse accessibility ≥ 90, string lint, manual check at 360 px | US-04, US-11–US-16 |
| NFR-14 | Cost efficiency | The system only pays for what it uses. | Pay-per-use services, except ElastiCache, kept as a hot-path optimization for dedupe and quota; correctness never depends on it (DynamoDB conditional writes + FIFO deduplication) · No NAT Gateway · Budget alerts at 50% and 80% of $50 USD (AWS and Google Cloud) | Terraform review, budget alerts configured before the first load test, test with Redis disabled (NFR-03) | — |

---

# 5. Arquitectura objetivo (producción)

Estas metas no aplican al MVP por las restricciones del Learner Lab (C-01, C-02), pero el diseño las contempla:

| Tema | Meta en producción |
| --- | --- |
| Disponibilidad | 99.9% mensual de la API (Multi-AZ, serverless); verificada con CloudWatch Synthetics |
| Recuperación | RPO ≤ 5 min (DynamoDB PITR) · RTO ≤ 1 h (redespliegue completo con Terraform) |
| Mínimo privilegio | Un rol IAM por función (en el MVP todo usa `LabRole`) |
| Protección en el borde | AWS WAF con *rate-based rules* por IP y *managed rules* (XSS/SQLi) |

---

# 6. Decisiones de diseño derivadas

Se detallan en el documento de arquitectura:

| RNF | Decisión |
| --- | --- |
| NFR-01, NFR-02 | Worker de IA en Lambda con *reserved concurrency* ajustada a la cuota de Gemini |
| NFR-01 | La biblioteca hace polling cada 3–5 s mientras haya ítems en `PROCESSING` (máx. 2 min) |
| NFR-03 | Deduplicación rápida con Redis `SET NX` con TTL sobre `userId#videoId`. **Redis es una optimización:** la garantía la dan la escritura condicional en DynamoDB y el `MessageDeduplicationId` de SQS FIFO |
| NFR-01, NFR-02, C-03, C-04 | **Caché global de análisis** por `videoId` en DynamoDB (Modelo D-09): solo se guardan resultados válidos con `confidence ≥ 0.7`, y `VIDEO_UNAVAILABLE` como caché negativa por 1 h |
| NFR-02, NFR-03 | **SQS FIFO** con `MessageGroupId = videoId`, para que el mismo video se analice uno a la vez y el segundo encuentre la caché llena. `MessageDeduplicationId = userId#videoId`. La DLQ también es FIFO. El *backoff* de reintentos se hace con `ChangeMessageVisibility`, porque FIFO no admite retraso por mensaje |
| NFR-04 | Un schedule recurrente por usuario con *flexible time window* de 5 min |
| NFR-09 | Dominio propio con DNS en Cloudflare (CNAME y validación de ACM gestionados por Terraform) para que el *origin* de la PWA no cambie entre despliegues |
| NFR-09 | Dominio de Cognito con prefijo fijo para que la *redirect URI* de Google no cambie |
| NFR-09 | State de Terraform en un bucket S3 versionado creado por un script de *bootstrap* en cada sesión, con *locking* nativo (`use_lockfile`, Terraform ≥ 1.10) |
| NFR-09 | **Schedule group `nudgee-reminders`** gestionado por Terraform; la Lambda crea los schedules de cada usuario dentro de él |
| NFR-14 | Solo la Lambda de ingesta vive en la VPC (Redis + *gateway endpoint* de DynamoDB + *interface endpoint* de SQS); el worker de IA queda fuera de la VPC |

---

# 7. Limitaciones conocidas del MVP

| Limitación | Causa |
| --- | --- |
| Los datos no persisten entre sesiones; cada sesión arranca vacía y se cargan datos de prueba (seed) | C-02 |
| Los recordatorios solo se envían mientras el entorno está desplegado | C-02 |
| Tras cada redespliegue los usuarios deben iniciar sesión y activar los recordatorios de nuevo | Se recrean el *user pool* de Cognito y la tabla única de DynamoDB, incluidos los registros de suscripciones push |
| No hay mínimo privilegio en IAM | C-01 (`LabRole`) |
| Sin garantía de disponibilidad | C-01, C-02 |
| Sin exportar datos ni eliminar cuenta | Fuera del alcance del MVP (ver backlog en el documento de RF) |
| La caché de análisis se pierde en cada redespliegue; en cada sesión, la primera vez que se guarda un video siempre llama a Gemini | C-02 |
| Si el análisis de un video falla y se reintenta, los demás usuarios que guardaron ese mismo video esperan a que termine (bloqueo de cabeza de fila en FIFO); los demás videos no se afectan | SQS FIFO agrupado por `videoId` |