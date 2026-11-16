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
  description = "Dominio completo de la PWA (p. ej. nudgee.saranda.studio). El certificado ACM ya debe existir y estar validado — bootstrap.sh lo crea una sola vez (ARQ-05), no en cada apply."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID de Cloudflare de la zona donde vive domain_name (Overview de la zona en el dashboard)"
  type        = string
}

variable "cloudflare_api_token" {
  description = "API token de Cloudflare con permiso de editar DNS en esa zona (obtenido de SSM, igual que vapid_public_key)"
  type        = string
  sensitive   = true
}
