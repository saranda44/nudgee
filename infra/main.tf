data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

output "account_id" {
  description = "ID de la cuenta de AWS donde se está desplegando"
  value       = data.aws_caller_identity.current.account_id
}

output "region" {
  description = "Región activa"
  value       = data.aws_region.current.name
}

module "dynamodb" {
  source = "./modules/dynamodb"

  table_name = "nudgee-main"
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

module "cognito" {
  source = "./modules/cognito"

  project_name         = var.project_name
  environment          = var.environment
  post_auth_lambda_arn = module.post_auth.lambda_arn
  aws_region           = data.aws_region.current.name
  load_test_enabled    = var.load_test_enabled

  # Rutas de Diseño UX §1.5: P-00 /auth/callback y P-01 /login. Local (Vite) y el dominio real
  # (Cloudflare) conviven en la misma lista; compact() quita el del dominio si no hay uno (domain_name
  # vacío — ver variables.tf).
  callback_urls = compact(["http://localhost:5173/auth/callback", var.domain_name != "" ? "https://${var.domain_name}/auth/callback" : ""])
  logout_urls   = compact(["http://localhost:5173/login", var.domain_name != "" ? "https://${var.domain_name}/login" : ""])

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_client_id" {
  value = module.cognito.user_pool_client_id
}

module "sqs" {
  source = "./modules/sqs"

  project_name = var.project_name
  environment  = var.environment

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

output "sqs_analysis_queue_url" {
  value = module.sqs.queue_url
}

# 1. Llamada al módulo de la Lambda Ingesta
module "ingesta" {
  source = "./modules/ingesta"

  project_name        = var.project_name
  environment         = var.environment
  dynamodb_table_name = module.dynamodb.table_name
  sqs_queue_url       = module.sqs.queue_url
}

# 1.1 Lambda Worker IA, consume la cola de análisis (Fase 3)
module "worker_ia" {
  source = "./modules/worker-ia"

  project_name        = var.project_name
  environment         = var.environment
  dynamodb_table_name = module.dynamodb.table_name
  sqs_queue_url       = module.sqs.queue_url
  sqs_queue_arn       = module.sqs.queue_arn
}

output "worker_ia_lambda_arn" {
  value = module.worker_ia.lambda_arn
}

# 2. API Gateway HTTP API
resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project_name}-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins  = ["*"]
    allow_methods  = ["POST", "GET", "OPTIONS", "PATCH", "DELETE"]
    allow_headers  = ["Content-Type", "Authorization", "If-Match", "X-Correlation-Id"]
    expose_headers = ["ETag", "Location", "Retry-After", "X-Correlation-Id"]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true

  route_settings {
    route_key              = "POST /v1/items"
    detailed_metrics_enabled = true
  }
}

# 3. JWT Authorizer conectado a tu Cognito
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-authorizer"

  jwt_configuration {
    # El client de pruebas de carga solo existe con load_test_enabled = true.
    audience = concat([module.cognito.user_pool_client_id], var.load_test_enabled ? [module.cognito.load_test_client_id] : [])
    issuer   = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${module.cognito.user_pool_id}"
  }
}

# 4. Integración Lambda Ingesta -> POST /v1/items
resource "aws_apigatewayv2_integration" "ingesta" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.ingesta.lambda_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_items" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /v1/items"
  target             = "integrations/${aws_apigatewayv2_integration.ingesta.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Permiso para que API Gateway invoque la Lambda
resource "aws_lambda_permission" "apigw_ingesta" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = "${var.project_name}-ingesta-${var.environment}"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.http_api.api_endpoint
}

# Lo lee backend/scripts/load-test.ts (terraform output -json); null con load_test_enabled = false.
output "load_test" {
  value = var.load_test_enabled ? {
    environment  = var.environment
    api_endpoint = aws_apigatewayv2_api.http_api.api_endpoint
    user_pool_id = module.cognito.user_pool_id
    client_id    = module.cognito.load_test_client_id
    table_name   = module.dynamodb.table_name
    queue_url    = module.sqs.queue_url
  } : null
}

module "post_auth" {
  source              = "./modules/post-auth"
  project_name        = var.project_name
  environment         = var.environment
  dynamodb_table_name = module.dynamodb.table_name
}

resource "aws_lambda_permission" "cognito_post_auth" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.post_auth.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = module.cognito.user_pool_arn
}

module "dlq" {
  source              = "./modules/dlq"
  project_name        = var.project_name
  environment         = var.environment
  dynamodb_table_name = module.dynamodb.table_name
  dlq_arn             = module.sqs.dlq_arn
  alarm_topic_arn     = var.alarm_topic_arn
}

# Lambda Dispatcher (Fase 4)
module "dispatcher" {
  source                = "./modules/dispatcher"
  project_name          = var.project_name
  environment           = var.environment
  dynamodb_table_name   = module.dynamodb.table_name
  dynamodb_table_arn    = module.dynamodb.table_arn
  vapid_public_key      = var.vapid_public_key
  lambda_index_path     = abspath("${path.module}/../backend/dist/dispatcher/index.js")
  lambda_timeout        = var.dispatcher_lambda_timeout
  notification_ttl_days = var.notification_ttl_days

  reminder_cooldown_minutes = var.reminder_cooldown_minutes
  reminder_max_per_item     = var.reminder_max_per_item
  upcoming_event_days       = var.upcoming_event_days

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

output "dispatcher_lambda_arn" {
  description = "ARN de la Lambda Dispatcher"
  value       = module.dispatcher.dispatcher_lambda_arn
}

output "scheduler_role_arn" {
  description = "ARN del IAM role para EventBridge Scheduler (usar en Terraform variables)"
  value       = module.dispatcher.scheduler_role_arn
}

# Lambda API (Fase 4)
module "api" {
  source                = "./modules/api"
  project_name          = var.project_name
  environment           = var.environment
  dynamodb_table_name   = module.dynamodb.table_name
  dynamodb_table_arn    = module.dynamodb.table_arn
  vapid_public_key      = var.vapid_public_key
  lambda_index_path     = abspath("${path.module}/../backend/dist/api/index.js")
  lambda_timeout        = var.api_lambda_timeout
  dispatcher_lambda_arn = module.dispatcher.dispatcher_lambda_arn
  scheduler_role_arn    = module.dispatcher.scheduler_role_arn

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# Permiso para que API Gateway invoque la Lambda API
resource "aws_lambda_permission" "apigw_api" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

# Integración de la Lambda API en API Gateway
resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.api.lambda_invoke_arn
  payload_format_version = "2.0"
}

# Ruta catch-all para los endpoints de la API (E-02 a E-22). El authorizer JWT es el que
# llena requestContext.authorizer.jwt.claims; el router toma userId de claims.sub (NFR-05).
# Un método por ruta, no "ANY": con "ANY" también se reclama OPTIONS, y como el preflight del
# navegador nunca manda Authorization, el authorizer JWT lo rechaza con 401 en vez de dejar que
# API Gateway responda el preflight automático de CORS (probado en vivo: solo pasaba al llamar
# a la API cross-origin, nunca en local vía el proxy de Vite, mismo origen = sin preflight).
resource "aws_apigatewayv2_route" "api_catchall" {
  for_each = toset(["GET", "POST", "PATCH", "DELETE"])

  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "${each.key} /v1/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# E-01: health check público (la ruta más específica gana sobre el catch-all)
resource "aws_apigatewayv2_route" "api_health" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /v1/health"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "NONE"
}

# Edge: Learner Lab niega cloudfront:CreateDistribution (y CreateOriginAccessControl/
# CreateFunction/CreateResponseHeadersPolicy antes de eso) — CloudFront no es viable en esta
# cuenta, punto. En vez de ARQ §4.1, Cloudflare (que ya está al frente del dominio) hace de
# CDN/TLS en modo proxied sobre el bucket S3 (sitio estático, bootstrap.sh). La API ya no vive
# en el mismo origen: el frontend le pega cross-origin a api_endpoint directo, con CORS (ya
# configurado arriba) en vez del behavior /v1/* que hubiera manejado CloudFront.
#
# El bucket se llama EXACTAMENTE igual que el dominio (no "${project}-frontend-${env}"): el
# endpoint de sitio web de S3 identifica el bucket por el header Host de la petición, y
# Cloudflare en modo proxied reenvía el Host original (el dominio) tal cual al origen — si no
# coinciden, S3 responde "NoSuchBucket". Reescribir el Host con una Origin Rule es función de
# un plan de pago de Cloudflare (probado, "not entitled to use the HostHeader override" en el
# plan gratis), así que esta es la alternativa gratis, y es el patrón que documenta AWS para
# S3 website hosting + dominio propio. No choca entre integrantes: un dominio registrado es
# único a nivel mundial, igual garantía que ya usa el bucket del state con el ACCOUNT_ID.
locals {
  frontend_bucket_name    = var.domain_name
  frontend_website_domain = "${local.frontend_bucket_name}.s3-website-${data.aws_region.current.name}.amazonaws.com"
}

# count en vez de siempre 1: sin domain_name (var vacía, ver variables.tf), no hay nada que
# apuntar en Cloudflare — así alguien sin dominio propio también puede desplegar el backend.
resource "cloudflare_record" "frontend" {
  count = var.domain_name != "" ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = var.domain_name
  type    = "CNAME"
  content = local.frontend_website_domain
  proxied = true # Cloudflare da el TLS (Universal SSL); ya no hace falta ACM.
  ttl     = 1    # Terraform exige 1 ("automático") cuando proxied = true.
}

output "frontend_url" {
  value = var.domain_name != "" ? "https://${var.domain_name}" : null
}

output "frontend_bucket" {
  description = "Bucket S3 del build del frontend (infra/deploy-frontend.sh); lo crea bootstrap.sh"
  value       = local.frontend_bucket_name
}

output "cognito_domain" {
  description = "Para el CSP (meta tag) en deploy-frontend.sh"
  value       = module.cognito.cognito_domain
}

# NFR-10 sin X-Ray: LabRole no tiene xray:PutTraceSegments (verificado con
# iam simulate-principal-policy, 2026-11-22), así que la traza de punta a punta se hace con el
# correlationId que ya viaja Ingesta → SQS → worker-ia → dlq. Consulta guardada en
# CloudWatch → Logs Insights → "Queries guardadas"; se reemplaza el valor del filtro.
resource "aws_cloudwatch_query_definition" "trace_by_correlation_id" {
  name = "${var.project_name}-${var.environment}/traza-por-correlationId"

  log_group_names = [for fn in [
    module.ingesta.function_name,
    module.worker_ia.function_name,
    module.dlq.function_name,
    module.api.function_name,
    module.dispatcher.function_name,
  ] : "/aws/lambda/${fn}"]

  query_string = <<-QUERY
    # Pega el correlationId (header X-Correlation-Id de la respuesta de POST /v1/items).
    # El dispatcher usa el id de ejecución del Scheduler: para seguir un recordatorio,
    # cambia el filtro por videoId = "<videoId>".
    fields @timestamp, @log, level, message, videoId, outcome, attempt
    | filter correlationId = "PEGA_AQUI_EL_CORRELATION_ID"
    | sort @timestamp asc
  QUERY
}
