variable "project_name" {
  description = "Nombre del proyecto"
  type        = string
}

variable "environment" {
  description = "Entorno (ej. dev, prod)"
  type        = string
}

variable "tags" {
  description = "Etiquetas base para los recursos"
  type        = map(string)
  default     = {}
}