# Observabilidad (Fase 9) — estado y guía de trabajo

NFR-10 · ARQ-18 · Arquitectura §4.8. Documento vivo del repo (no es export de Notion): actualízalo al cerrar cada pieza.
Última actualización: 2026-11-23.

## Reparto

| Pieza | Quién | Estado |
| --- | --- | --- |
| A. Métricas EMF `AnalysisDeadLettered` (dlq) y `PushSent` (dispatcher) | Emilio | ✅ PR #27, probado en `dev-emilio` |
| D. Alarma `AnalysisDeadLettered > 0` | Emilio | ✅ PR #27, probada (OK → ALARM → OK) |
| Script de pruebas de carga | Emilio | ✅ rama `feat/pruebas-carga`, probado en `dev-emilio` con 15 requests (ver §5) |
| Traza de punta a punta (en lugar de X-Ray) | Emilio | ✅ rama `feat/observabilidad-trazas`, probada en `dev-emilio` (ver §7) |
| B. Dashboard NFR-10 (en Terraform) | Sara | ⏳ sin empezar |
| C. Paneles de escalabilidad | Sara | ⏳ sin empezar |
| D. Alarmas 5xx > 1 % en 5 min y mensaje más viejo > 5 min, topic SNS | Sara | ⏳ sin empezar |
| Pruebas de carga en el lab de la demo | Los dos | ⏳ al final, cuando esté el dashboard |

## 1. Métricas disponibles (namespace `Nudgee`)

Emitidas con EMF (`backend/shared/emf.ts`): un `console.log` que CloudWatch convierte en métrica, sin llamadas extra ni latencia.

| Métrica | Unidad | Dimensiones | Emisor | Notas |
| --- | --- | --- | --- | --- |
| `AnalysisDurationMs` | Milliseconds | `analysisSource` = `GEMINI` \| `CACHE` | worker-ia | `readyAt − savedAt` |
| `GeminiError` | Count | `type` = `429` \| `5xx` \| `TIMEOUT` \| `INVALID_OUTPUT` | worker-ia | |
| `AnalysisDeadLettered` | Count | *(ninguna)* | dlq | 1 por mensaje que llega a la DLQ, incluso malformado |
| `PushSent` | Count | `status` = `SENT` \| `PARTIAL` \| `FAILED` \| `IN_APP` | dispatcher | 1 por recordatorio registrado; no se emite si la franja ya existía |
| `GeminiCallMs` | Milliseconds | *(ninguna)* | worker-ia | ⚠️ definida en `worker-ia/metrics.ts` pero **nunca se llama** |

Una métrica EMF solo existe en CloudWatch después de su primera emisión. Un panel vacío antes de la prueba de carga es normal.

### Fórmulas sugeridas (metric math)

- **Aciertos de caché:** `SampleCount(AnalysisDurationMs, CACHE) / (SampleCount(CACHE) + SampleCount(GEMINI)) * 100`.
- **Éxito de push:** `SENT / (SENT + PARTIAL + FAILED) * 100`, con `Sum` de `PushSent` por `status`. `IN_APP` (usuario sin suscripciones) no cuenta como fallo.
- **5xx > 1 %:** `5xx / Count * 100` de `AWS/ApiGateway` (dimensión `ApiId`).

## 2. Nombres de recursos para el dashboard (`{env}` = `var.environment`)

| Recurso | Nombre |
| --- | --- |
| Lambdas | `nudgee-{api,ingesta,worker-ia,dispatcher,post-auth,dlq}-{env}` |
| Cola de análisis | `nudgee-analysis-{env}.fifo` (`ApproximateNumberOfMessagesVisible`, `ApproximateAgeOfOldestMessage`) |
| DLQ | `nudgee-analysis-dlq-{env}.fifo`. Su profundidad no sirve para alarmar porque la Lambda dlq la vacía al instante: usa `AnalysisDeadLettered` |
| Tabla | `nudgee-main` (sin `{env}`): `ConsumedRead/WriteCapacityUnits`, `ThrottledRequests` |
| API | `aws_apigatewayv2_api.http_api` en `infra/main.tf`, dimensión `ApiId` |
| Alarma de DLQ | `nudgee-analysis-dead-lettered-{env}` (`infra/modules/dlq/main.tf`) |
| Consulta de traza | `nudgee-{env}/traza-por-correlationId` (Logs Insights → Consultas guardadas) |

Mejor referencia los nombres con atributos de Terraform (`module.x...`, `aws_apigatewayv2_api.http_api.id`) que como texto.

## 3. Pendientes de Sara (con pistas)

1. **p95/p99 de `POST /v1/items` necesita métricas detalladas por ruta.** El stage `aws_apigatewayv2_stage.default` (`infra/main.tf`) no las tiene activadas, así que hoy solo hay métricas de toda la API. Agregar `route_settings { route_key = "POST /v1/items"  detailed_metrics_enabled = true }`; NFR-01 lo pide solo en esa ruta. Con eso aparece la dimensión `Route`.
2. **Topic SNS:** créalo con su suscripción de correo (hay que confirmar el correo que manda AWS) y expón su ARN. Después, en `infra/main.tf`, `module "dlq"`, cambia `alarm_topic_arn = var.alarm_topic_arn` por el output de tu topic. Mientras esté vacío, la alarma existe pero no avisa.
3. **Widget de escalabilidad clave:** `ApproximateNumberOfMessagesVisible` de la cola + `ConcurrentExecutions` de `nudgee-worker-ia-{env}` en la misma gráfica. El event source mapping fija `maximum_concurrency = 2` (`infra/modules/worker-ia/main.tf`): en el pico la cola sube y el worker se queda en 2.
4. **Bug de `cloudflare_api_token` (sigue en `main` al 2026-11-23):** el default `"no-token-configured"` no pasa la validación del provider v4, que exige 40 caracteres. Sin dominio, `terraform plan` falla. Arreglo propuesto: un placeholder de 40 caracteres, p. ej. `placeholder_no_token_0000000000000000000`.
5. **Revisar los PRs de Emilio** (`feat/observabilidad-trazas` y `feat/pruebas-carga`) antes del merge (ver §6). El #27 ya se mergeó.

## 4. Cómo probar las alarmas

- **DLQ (sin efectos en datos):** un mensaje sin `userId` → la Lambda cuenta la métrica y no escribe en DynamoDB.
  ```bash
  DLQ=$(aws sqs get-queue-url --queue-name nudgee-analysis-dlq-<env>.fifo --query QueueUrl --output text)
  aws sqs send-message --queue-url "$DLQ" --message-body '{"videoId":"prueba","correlationId":"prueba-alarma"}' \
    --message-group-id prueba --message-deduplication-id "prueba-$(date +%s)"
  ```
  Esperado: ALARM en ~1 min y regreso a OK solo, en ~7 min.
- **PushSent:** `aws lambda invoke --function-name nudgee-dispatcher-<env>` con el payload `{"userId":"<sub>","scheduledTime":"<ISO ahora>"}` de un usuario con ítems `PENDING`. Esto manda un push real y deja el recordatorio en la bandeja.

## 5. Pruebas de carga

Se corren en el lab de la demo: el dashboard solo grafica su propia cuenta, y CloudWatch guarda las métricas 15 días aunque se destruya la infra. Script: `backend/scripts/load-test/index.ts` (lógica pura y tests en `plan.ts` / `plan.test.ts`).

**Restricciones del código que el script ya respeta:** cuota de 30 guardados/h y 100/día por usuario (`backend/ingesta/dynamo.ts`); usuario + `videoId` repetido da `409` (el plan nunca lo repite); por eso hacen falta ~35 usuarios de prueba. Límite acordado: ~1,700–2,500 requests entre los dos.

**Costo de Gemini (dinero real):** el worker solo guarda en caché un análisis `OK` con confianza ≥ 0.7. Un video que no queda en caché llama a Gemini **cada vez** que alguien lo guarda. Por eso:
- `run` **solo** usa videos con caché `OK` en DynamoDB → 0 llamadas a Gemini, aunque sean 875 requests.
- Gemini solo se llama en `warmup`: una vez por video sin caché, de a uno (sin 429 de la cuota gratuita) y con tope `--max-gemini` (30).
- `cleanup` no borra la caché (`VIDEO#…`), así que repetir la prueba no vuelve a costar.

**Infra:** `load_test_enabled` (default `false`) crea el app client `nudgee-loadtest-client-{env}` con `ADMIN_USER_PASSWORD_AUTH` (solo funciona con credenciales de AWS; sin OAuth ni Hosted UI; el client PKCE de la PWA no cambia) y lo agrega al `audience` del authorizer. Apagado, `terraform plan` no muestra cambios. **Apágalo al terminar.**

**Pasos (desde `backend/`, con credenciales del lab y `terraform init` hecho en `infra/`):**
1. `terraform plan ... -var load_test_enabled=true -out=tf.plan`, revisar (1 add, 1 change) y `apply`.
2. Pool: un archivo con 20–30 videoIds de Shorts reales, uno por línea (`#` comenta).
3. `node scripts/load-test/index.ts warmup --videos pool.txt` → muestra cuántas llamadas a Gemini hará; repetir con `--yes`. Los videos que salgan "sin caché" quedan fuera de `run` solos.
4. `node scripts/load-test/index.ts run --videos pool.txt` → por defecto 35 usuarios × 25 videos = 875 requests a 15 req/s (~1 min); repetir con `--yes`. Muestra la cola cada 5 s hasta que se vacía y al final los códigos HTTP, p50/p95/p99 y el pico. Corta solo si > 5 % son 5xx. Opciones: `--users`, `--per-user`, `--rate`, `--max-requests` (900).
5. `node scripts/load-test/index.ts cleanup --yes` → borra los usuarios `loadtest-*` y su partición. Hay que correrlo antes de repetir `run` (si no, todo sale 409).
6. `terraform plan` sin la variable (1 change, 1 destroy) y `apply`.

Cada request lleva `X-Correlation-Id: loadtest-<runId>-<n>`: se puede seguir con la consulta de §7.

**Prueba en `dev-emilio` (2026-11-23):** 5 usuarios × 3 videos en caché a 5 req/s → 15/15 `202`, p50 199 ms; en Logs Insights 15 `CREATED` en Ingesta y 15 `cache_hit_ok` en el worker (0 llamadas a Gemini); `cleanup` borró 5 usuarios y 30 registros. La cola no subió: a 5 req/s el worker la vacía al momento. El pico requiere el ritmo por defecto (15 req/s) y 875 requests.

## 6. Forma de trabajo

- **Revisión cruzada:** hasta el PR #26 ningún PR tuvo review. Desde ahora, el que no escribió el PR lo revisa antes del merge: Sara revisa los de Emilio y viceversa. En Claude Code: `/review-pr <número>`.
- **Antes de abrir PR:** `cd backend && npm run typecheck && npm test`, y `terraform fmt -check && terraform validate` si tocaste infra.
- **Al desplegar:** `terraform plan` siempre antes de `apply`. Learner Lab desactiva los event source mappings de SQS al cerrar sesión; el siguiente `apply` los reactiva (sale como `enabled false → true`, es normal).

## 7. NFR-10: traza de punta a punta (sin X-Ray) y huecos

- **X-Ray no es viable en Learner Lab.** `iam simulate-principal-policy` sobre `LabRole` da `implicitDeny` para `xray:PutTraceSegments`, `PutTelemetryRecords`, `GetSamplingRules` y `GetSamplingTargets`, y para `xray:GetTraceSummaries` con el usuario `voclabs` (el mismo simulador sí da `allowed` en DynamoDB, SQS, logs, SSM, Scheduler y `PutMetricData`). Activar `tracing_config { mode = "Active" }` haría fallar el `apply`. Es una desviación documentada de NFR-10 / Arquitectura §4.8, igual que CloudFront.
- **En su lugar:** el `correlationId` ya viaja Ingesta → SQS → worker-ia → dlq, e Ingesta ahora registra cada guardado (`CREATED`, `DUPLICATE`, `QUOTA_EXCEEDED`). La consulta guardada `nudgee-{env}/traza-por-correlationId` (CloudWatch → Logs Insights → Consultas guardadas) muestra en orden lo que hizo cada Lambda: se pega el valor del header `X-Correlation-Id` de la respuesta de `POST /v1/items`. El dispatcher usa el id de ejecución del Scheduler; un recordatorio se sigue por `videoId`.
  - Probado en `dev-emilio`: Ingesta `CREATED` (03:41:45.126) → worker "Procesando análisis" (46.085) → `cache_hit_ok` (46.297).
  - Para la demo: guardar un Short, copiar el `X-Correlation-Id` (DevTools → Network) y correr la consulta.
- **`GeminiCallMs`:** está definida pero no se emite (§1). No la pide NFR-10; opcional.
- **Métricas de Ingesta** `SaveAccepted`, `SaveDuplicate` y `QuotaExceeded` (Arquitectura §4.8): no se emiten. Opcionales para el dashboard.
- **Bugs que ya existían en la Lambda dlq:** el `UpdateCommand` sin condición recrea un ítem "fantasma" si el usuario lo borró, y un error de DynamoDB se ignora (el ítem queda en `PROCESSING`).
