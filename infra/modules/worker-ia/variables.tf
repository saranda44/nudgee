variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "dynamodb_table_name" {
  type = string
}

variable "sqs_queue_url" {
  description = "URL de la cola SQS FIFO de análisis, para el backoff con ChangeMessageVisibility"
  type        = string
}

variable "sqs_queue_arn" {
  description = "ARN de la cola SQS FIFO de análisis, para el event source mapping"
  type        = string
}

variable "gemini_model" {
  description = "Modelo de Gemini a usar (confirmado en vivo: Flash Lite, 500 solicitudes/día gratis vs. 20 de Flash completo)"
  type        = string
  default     = "gemini-3.5-flash-lite"
}

variable "analysis_version" {
  description = "Versión del prompt/schema; se incrementa a mano al cambiarlos"
  type        = number
  default     = 1
}

variable "cache_confidence_threshold" {
  description = "Umbral de confianza para guardar en la caché global"
  type        = number
  default     = 0.7
}

variable "cache_ttl_ok_seconds" {
  description = "TTL de la caché para análisis OK (90 días)"
  type        = number
  default     = 7776000
}

variable "cache_ttl_unavailable_seconds" {
  description = "TTL de la caché negativa para VIDEO_UNAVAILABLE (1 hora)"
  type        = number
  default     = 3600
}

variable "gemini_timeout_ms" {
  description = "Timeout de la llamada a Gemini en código"
  type        = number
  default     = 45000
}
