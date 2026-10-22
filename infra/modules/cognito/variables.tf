variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "callback_urls" {
  description = "URLs permitidas para redirección tras un login exitoso"
  type        = list(string)
}

variable "logout_urls" {
  description = "URLs permitidas para redirección tras el logout"
  type        = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "aws_region" {
  description = "Región de AWS"
  type        = string
}