variable "table_name" {
  description = "Nombre de la tabla principal de DynamoDB"
  type        = string
  default     = "nudgee-main"
}

variable "tags" {
  description = "Etiquetas base para los recursos"
  type        = map(string)
  default     = {}
}