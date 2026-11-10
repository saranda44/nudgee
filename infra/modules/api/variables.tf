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
  description = "Ruta al archivo compilado index.js de la Lambda API"
}

variable "lambda_timeout" {
  type        = number
  description = "Timeout de la Lambda en segundos"
  default     = 30
}

variable "dispatcher_lambda_arn" {
  type        = string
  description = "ARN de la Lambda Dispatcher (para E-04)"
  default     = ""
}

variable "scheduler_role_arn" {
  type        = string
  description = "ARN del IAM role de Scheduler (para E-04)"
  default     = ""
}

variable "tags" {
  type        = map(string)
  description = "Tags para todos los recursos"
  default     = {}
}
