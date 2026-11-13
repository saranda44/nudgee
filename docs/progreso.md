# Progreso

# Resumen Ejecutivo

Nudgee es una PWA y un backend serverless, orientado a eventos y desplegado en AWS, diseñado para convertir enlaces guardados de YouTube Shorts en acciones concretas. Utiliza la API de Gemini Flash estructurada con JSON Schemas para extraer metadatos. La lógica transaccional y de cuotas reside en una tabla única de DynamoDB (Single-Table Design), orquestando la ingesta a través de HTTP API Gateway y desacoplando el procesamiento pesado mediante colas SQS FIFO. La infraestructura se gestiona con Terraform, respetando estrictamente los límites del `LabRole` del AWS Academy Learner Lab.

## Desglose Secuencial de Fases (Phase Checklist)

Se renumeró del checklist original de 6 fases a 9, para darle su propio lugar a 3 Lambdas que ya estaban en la Arquitectura pero no en el plan: **Post-Auth**, **API (router interno)** y **DLQ**.

- [x]  **Fase 1: Cimientos IaC, Identidad y Base de Datos:** Bootstrap de Terraform (state bucket en S3), tabla única de DynamoDB (GSI1) y Cognito User Pool.
- [x]  **Fase 2: Borde e Ingesta:** HTTP API Gateway con Authorizer JWT y Lambda de Ingesta **completa y probada en AWS real**: valida el link, deduplica y descuenta cuota en una sola transacción, encola en SQS FIFO, reencola duplicados atascados, compensa si falla el encolado, errores en RFC 9457.
- [x]  **Fase 3: Mensajería, Worker IA y Caché — en curso:** Cola SQS FIFO (lista desde Fase 1), Lambda Worker IA, integración con Gemini API y caché global en DynamoDB.
    - [x]  M1 — Schemas de las 10 categorías (TypeBox, 3 vistas, Ajv), sobre de salida de Gemini.
    - [x]  M2 — Prompt versionado y normalización de la salida de Gemini.
    - [x]  M3 — Integración en el Worker (caché, Gemini real, módulo Terraform `worker-ia`).
- [x]  **Fase 4: Lambda Post-Auth:** trigger *Post Authentication* de Cognito. Crea o actualiza el perfil (`PROFILE`) .
- [x]  **Fase 5: Lambda DLQ:** consume `nudgee-analysis-dlq.fifo` (ya existe la cola). Si el ítem sigue en `PROCESSING`, lo marca `NEEDS_INPUT` + `RETRIES_EXHAUSTED.`
- [x]  **Fase 6: Lambda API (router interno):** el resto de los endpoints de `/v1` que no son `POST /items` (perfil, biblioteca, acciones de ítems con `ETag`/`If-Match`, checklist, suscripciones push, apertura desde notificación, `/config`, `/health`). Valida con los schemas de `backend/schemas/` (Ajv + JSON Pointer) y aplica las transiciones de estado condicionales de RF §4.
- [x]  **Fase 7: Motor de Recordatorios:** EventBridge Scheduler, Lambda Despachadora (evaluación de reglas y push) y Web Push vía VAPID.
- [ ]  **Fase 8: Frontend PWA e Integración:** Hosting de estáticos, Service Worker, componentes React y consumo de API.
- [ ]  **Fase 9: Observabilidad y QA:** X-Ray, CloudWatch (EMF) y demostración.

## Infraestructura Desplegada y probada (Fases 1 y 2)

- **Stack Persistente (S3 + SSM):** Configurado vía bash para proteger el estado de Terraform y guardar los secretos vacíos (Gemini y VAPID) ante los reinicios del Learner Lab.
- **DynamoDB (`nudgee-main`):** Tabla única On-Demand con `GSI1`. Confirmado en AWS real: `ITEM` en `PROCESSING`, `QUOTA_COUNTER` por hora/día actualizándose correctamente.
- **Cognito:** User Pool Lite y App Client para el flujo PKCE de la PWA. **Sin IdP de Google ni trigger Post-Auth todavía** (Fase 4).
- **SQS FIFO:** `nudgee-analysis-{env}.fifo` + DLQ, confirmado recibiendo mensajes reales de Ingesta.
- **API Gateway + Lambda Ingesta:** endpoint desplegado, authorizer JWT activo, **lógica de negocio completa** (no solo el esqueleto): probada contra DynamoDB/SQS reales — guarda, descuenta cuota una sola vez, deduplica con `409`, encola para el Worker IA.
- **`backend/schemas/`** (nuevo, Fase 3): paquete compartido en TypeBox con las 10 categorías y sus 3 vistas, Ajv estricto y el sobre de salida de Gemini.

## Handoff — próximos pasos

Las Fases 4–6 (Post-Auth, DLQ, API). 

## Cómo probarlo

```bash
correr bootstrap.sh
cd backend
npm install
npm run build     # genera dist/<lambda>/index.js de las 5 Lambdas

cd ../infra
terraform init
terraform plan 
terraform apply
```

Configura API KEY de Gemini

```markdown
aws ssm put-parameter --name /nudgee/GEMINI_API_KEY --type SecureString --overwrite --value "<TU_GEMINI_API_KEY>"
```

**Probar lambda ingesta** (sin pasar por el login de Cognito, invocando la Lambda directo):

```bash
aws lambda invoke \
  --function-name nudgee-ingesta-dev-sara \
  --cli-binary-format raw-in-base64-out \
  --payload '{"headers":{},"requestContext":{"authorizer":{"jwt":{"claims":{"sub":"test-user-001"}}}},"body":"{\"url\":\"<https://www.youtube.com/shorts/><videoId>\"}","isBase64Encoded":false}' \
  /tmp/respuesta.json && cat /tmp/respuesta.json
```

Revisar registro en DynamoDB