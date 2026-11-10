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

  callback_urls = ["http://localhost:5173/callback"]
  logout_urls   = ["http://localhost:5173/"]

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
}

# 3. JWT Authorizer conectado a tu Cognito
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-authorizer"

  jwt_configuration {
    audience = [module.cognito.user_pool_client_id]
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
}

# Lambda Dispatcher (Fase 4)
module "dispatcher" {
  source                 = "./modules/dispatcher"
  project_name           = var.project_name
  environment            = var.environment
  dynamodb_table_name    = module.dynamodb.table_name
  dynamodb_table_arn     = module.dynamodb.table_arn
  vapid_public_key       = var.vapid_public_key
  lambda_index_path      = abspath("${path.module}/../backend/dist/dispatcher/index.js")
  lambda_timeout         = var.dispatcher_lambda_timeout
  notification_ttl_days  = var.notification_ttl_days

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
  source                  = "./modules/api"
  project_name            = var.project_name
  environment             = var.environment
  dynamodb_table_name     = module.dynamodb.table_name
  dynamodb_table_arn      = module.dynamodb.table_arn
  vapid_public_key        = var.vapid_public_key
  lambda_index_path       = abspath("${path.module}/../backend/dist/api/index.js")
  lambda_timeout          = var.api_lambda_timeout
  dispatcher_lambda_arn   = module.dispatcher.dispatcher_lambda_arn
  scheduler_role_arn      = module.dispatcher.scheduler_role_arn

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

# Ruta catch-all para todos los endpoints de la API (E-01 a E-22)
# Esto despacha todas las rutas bajo /v1 al handler del router
resource "aws_apigatewayv2_route" "api_catchall" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "ANY /v1/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "NONE" # E-01 sin auth; otras usan JWT en el handler
}

# Ruta para /v1 sin proxy (ej. GET /v1/health)
resource "aws_apigatewayv2_route" "api_root" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "ANY /v1"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "NONE"
}
