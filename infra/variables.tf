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