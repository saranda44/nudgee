variable "aws_region" {
  description = "Región de AWS para desplegar el proyecto"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Nombre del proyecto"
  type        = string
  default     = "nudgee"
}

variable "environment" {
  description = "Entorno de despliegue"
  type        = string
  default     = "dev"
}

variable "vapid_public_key" {
  description = "VAPID public key para Web Push (obtenida de SSM)"
  type        = string
  sensitive   = false
}

variable "api_lambda_timeout" {
  description = "Timeout de la Lambda API en segundos"
  type        = number
  default     = 30
}

variable "dispatcher_lambda_timeout" {
  description = "Timeout de la Lambda Dispatcher en segundos"
  type        = number
  default     = 60
}

variable "notification_ttl_days" {
  description = "Días que durará una notificación en la bandeja antes de expirar (Modelo §3.4)"
  type        = number
  default     = 30
}

variable "reminder_cooldown_minutes" {
  type        = number
  description = "Cooldown entre recordatorios del mismo ítem, en minutos (US-41; 4320 = 3 días)"
  default     = 4320
}

variable "reminder_max_per_item" {
  type        = number
  description = "Recordatorios ignorados antes de pasar a DORMANT (US-42, T-07)"
  default     = 3
}

variable "upcoming_event_days" {
  type        = number
  description = "Ventana de eventos próximos con prioridad, en días (US-50)"
  default     = 7
}

variable "domain_name" {
  description = "Dominio completo de la PWA (p. ej. nudgee.saranda.studio). Opcional: vacío = sin dominio propio, el frontend solo corre en local (npm run dev)."
  type        = string
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "Zone ID de Cloudflare de la zona donde vive domain_name (Overview de la zona en el dashboard). Solo hace falta si domain_name no está vacío."
  type        = string
  default     = ""
}

variable "cloudflare_api_token" {
  description = "API token de Cloudflare con permiso de editar DNS en esa zona (obtenido de SSM, igual que vapid_public_key). Solo hace falta si domain_name no está vacío. El provider de Cloudflare valida el FORMATO de esto siempre (aunque ningún recurso lo use si domain_name está vacío) — un \"\" no pasa esa validación (pide mínimo 1 carácter), por eso el default es un placeholder con formato válido, nunca un token real."
  type        = string
  default     = "placeholder_no_token_0000000000000000000"
  sensitive   = true
}

variable "alarm_topic_arn" {
  description = "Topic SNS para las alarmas de CloudWatch (NFR-10); vacío = sin notificación"
  type        = string
  default     = ""
}

variable "load_test_enabled" {
  description = "Crea el app client de Cognito para las pruebas de carga (ADMIN_USER_PASSWORD_AUTH) y lo agrega al audience del authorizer. Apagado por defecto; ver docs/observabilidad.md §5."
  type        = bool
  default     = false
}
