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