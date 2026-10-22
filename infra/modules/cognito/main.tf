# User Pool
resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-user-pool-${var.environment}"

  # En el MVP, Google será el IdP principal, pero dejamos el email por defecto
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  tags = var.tags
}

# Dominio con prefijo fijo
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_name}-auth-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id
}

# App Client público para la PWA
resource "aws_cognito_user_pool_client" "pwa" {
  name         = "${var.project_name}-pwa-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false # Obligatorio en false para SPAs/PWAs

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"] # Agregaremos "Google" más adelante

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  prevent_user_existence_errors = "ENABLED"
}