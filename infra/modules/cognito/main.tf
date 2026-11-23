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

  dynamic "lambda_config" {
    for_each = var.post_auth_lambda_arn != "" ? [1] : []
    content {
      post_authentication = var.post_auth_lambda_arn
      # El registro en el Hosted UI inicia sesión sin disparar Post Authentication
      post_confirmation = var.post_auth_lambda_arn
    }
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

# Estilo del Hosted UI con los colores/tipografía de Nudgee (hosted-ui.css). "ALL" = todos los
# App Clients del pool; depende del dominio porque el Hosted UI no existe sin él.
resource "aws_cognito_user_pool_ui_customization" "all_clients" {
  client_id    = "ALL"
  user_pool_id = aws_cognito_user_pool.main.id

  css        = file("${path.module}/hosted-ui.css")
  image_file = filebase64("${path.module}/../../../frontend/public/logo-png-transparente.png")

  depends_on = [aws_cognito_user_pool_domain.main]
}
# App client SOLO para las pruebas de carga (docs/observabilidad.md §5), apagado por defecto.
# ADMIN_USER_PASSWORD_AUTH exige credenciales de AWS (cognito-idp:AdminInitiateAuth): nadie
# puede usarlo desde internet. Sin OAuth ni Hosted UI; el client PKCE de la PWA no cambia.
resource "aws_cognito_user_pool_client" "load_test" {
  count = var.load_test_enabled ? 1 : 0

  name         = "${var.project_name}-loadtest-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret     = false
  explicit_auth_flows = ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 1

  prevent_user_existence_errors = "ENABLED"
}
