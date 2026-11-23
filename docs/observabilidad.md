# Observabilidad (Fase 9) — estado y guía de trabajo

NFR-10 · ARQ-18 · Arquitectura §4.8. Documento vivo del repo (no es export de Notion): actualízalo al cerrar cada pieza.
Última actualización: 2026-11-22.

## Reparto

| Pieza | Quién | Estado |
| --- | --- | --- |
| A. Métricas EMF `AnalysisDeadLettered` (dlq) y `PushSent` (dispatcher) | Emilio | ✅ PR #27, probado en `dev-emilio` |
| D. Alarma `AnalysisDeadLettered > 0` | Emilio | ✅ PR #27, probada (OK → ALARM → OK) |
| Script de pruebas de carga | Emilio | ⏳ por diseñar (ver §5) |
| B. Dashboard NFR-10 (en Terraform) | Sara | ⏳ sin empezar |
| C. Paneles de escalabilidad | Sara | ⏳ sin empezar |
| D. Alarmas 5xx > 1 % en 5 min y mensaje más viejo > 5 min, topic SNS | Sara | ⏳ sin empezar |
| Pruebas de carga en el lab de la demo | Los dos | ⏳ al final |

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

Mejor referencia los nombres con atributos de Terraform (`module.x...`, `aws_apigatewayv2_api.http_api.id`) que como texto.

## 3. Pendientes de Sara (con pistas)

1. **p95/p99 de `POST /v1/items` necesita métricas detalladas por ruta.** El stage `aws_apigatewayv2_stage.default` (`infra/main.tf`) no las tiene activadas, así que hoy solo hay métricas de toda la API. Agregar `route_settings { route_key = "POST /v1/items"  detailed_metrics_enabled = true }`; NFR-01 lo pide solo en esa ruta. Con eso aparece la dimensión `Route`.
2. **Topic SNS:** créalo con su suscripción de correo (hay que confirmar el correo que manda AWS) y expón su ARN. Después, en `infra/main.tf`, `module "dlq"`, cambia `alarm_topic_arn = var.alarm_topic_arn` por el output de tu topic. Mientras esté vacío, la alarma existe pero no avisa.
3. **Widget de escalabilidad clave:** `ApproximateNumberOfMessagesVisible` de la cola + `ConcurrentExecutions` de `nudgee-worker-ia-{env}` en la misma gráfica. El event source mapping fija `maximum_concurrency = 2` (`infra/modules/worker-ia/main.tf`): en el pico la cola sube y el worker se queda en 2.
4. **Bug de `cloudflare_api_token`:** el default `"no-token-configured"` no pasa la validación del provider v4, que exige 40 caracteres. Sin dominio, `terraform plan` falla. Arreglo propuesto: un placeholder de 40 caracteres, p. ej. `placeholder_no_token_0000000000000000000`.
5. **Revisar el PR #27** antes de mergearlo (ver §6).

## 4. Cómo probar las alarmas

- **DLQ (sin efectos en datos):** un mensaje sin `userId` → la Lambda cuenta la métrica y no escribe en DynamoDB.
  ```bash
  DLQ=$(aws sqs get-queue-url --queue-name nudgee-analysis-dlq-<env>.fifo --query QueueUrl --output text)
  aws sqs send-message --queue-url "$DLQ" --message-body '{"videoId":"prueba","correlationId":"prueba-alarma"}' \
    --message-group-id prueba --message-deduplication-id "prueba-$(date +%s)"
  ```
  Esperado: ALARM en ~1 min y regreso a OK solo, en ~7 min.
- **PushSent:** `aws lambda invoke --function-name nudgee-dispatcher-<env>` con el payload `{"userId":"<sub>","scheduledTime":"<ISO ahora>"}` de un usuario con ítems `PENDING`. Esto manda un push real y deja el recordatorio en la bandeja.

## 5. Pruebas de carga (Emilio, por diseñar)

Se corren en el lab de la demo: el dashboard solo grafica su propia cuenta, y CloudWatch guarda las métricas 15 días aunque se destruya la infra. Restricciones del código:

- Cuota de **30 guardados/h y 100/día por usuario** (`backend/ingesta/dynamo.ts`).
- Repetir usuario + `videoId` da `409`, y la FIFO descarta duplicados durante 5 min. Para llenar la cola hacen falta **~30–40 usuarios de prueba**.
- Pool de 20–30 `videoId`. La caché global hace que Gemini se llame ~1 vez por video, así que el costo de Gemini es mínimo.
- Límite acordado: ~1,700–2,500 requests en total.
- Propuesta: un app client de Cognito aparte con `ADMIN_USER_PASSWORD_AUTH`, **apagado por defecto** con una variable. Solo funciona con credenciales de AWS y no toca el login PKCE.

## 6. Forma de trabajo

- **Revisión cruzada:** hasta el PR #26 ningún PR tuvo review. Desde ahora, el que no escribió el PR lo revisa antes del merge: Sara revisa los de Emilio y viceversa. En Claude Code: `/review-pr <número>`.
- **Antes de abrir PR:** `cd backend && npm run typecheck && npm test`, y `terraform fmt -check && terraform validate` si tocaste infra.
- **Al desplegar:** `terraform plan` siempre antes de `apply`. Learner Lab desactiva los event source mappings de SQS al cerrar sesión; el siguiente `apply` los reactiva (sale como `enabled false → true`, es normal).

## 7. Huecos de NFR-10 sin dueño (decidir quién)

- **X-Ray:** NFR-10 y Arquitectura §4.8 lo piden en las 6 Lambdas, y la verificación de NFR-10 es "traza de punta a punta en la demo". Hoy ningún módulo tiene `tracing_config { mode = "Active" }`. Falta verificar que `LabRole` tenga permisos de X-Ray.
- **`GeminiCallMs`:** está definida pero no se emite (§1).
- **Métricas de Ingesta** `SaveAccepted`, `SaveDuplicate` y `QuotaExceeded` (Arquitectura §4.8): no se emiten. Opcionales para el dashboard.
- **Bugs que ya existían en la Lambda dlq:** el `UpdateCommand` sin condición recrea un ítem "fantasma" si el usuario lo borró, y un error de DynamoDB se ignora (el ítem queda en `PROCESSING`).
