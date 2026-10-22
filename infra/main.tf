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

  project_name = var.project_name
  environment  = var.environment
  aws_region   = data.aws_region.current.name

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

# 2. API Gateway HTTP API
resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project_name}-api-${var.environment}"
  protocol_type = "HTTP"
  
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "GET", "OPTIONS", "PATCH", "DELETE"]
    allow_headers = ["Content-Type", "Authorization", "If-Match", "X-Correlation-Id"]
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