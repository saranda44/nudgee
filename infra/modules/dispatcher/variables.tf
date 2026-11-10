variable "project_name" {
  type        = string
  description = "Nombre del proyecto"
}

variable "environment" {
  type        = string
  description = "Entorno (dev, prod, etc)"
  default     = "dev"
}

variable "dynamodb_table_name" {
  type        = string
  description = "Nombre de la tabla DynamoDB"
}

variable "dynamodb_table_arn" {
  type        = string
  description = "ARN de la tabla DynamoDB"
}

variable "vapid_public_key" {
  type        = string
  description = "VAPID public key para Web Push"
}

variable "lambda_index_path" {
  type        = string
  description = "Ruta al archivo compilado index.js de la Lambda Dispatcher"
}

variable "lambda_timeout" {
  type        = number
  description = "Timeout de la Lambda en segundos"
  default     = 60
}

variable "notification_ttl_days" {
  type        = number
  description = "Días que durará una notificación en la bandeja antes de expirar"
  default     = 7
}

variable "tags" {
  type        = map(string)
  description = "Tags para todos los recursos"
  default     = {}
}
