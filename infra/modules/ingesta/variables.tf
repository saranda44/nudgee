variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "dynamodb_table_name" {
  description = "Nombre de la tabla principal para transacciones de guardado y cuotas"
  type        = string
}

variable "sqs_queue_url" {
  description = "URL de la cola SQS FIFO destino"
  type        = string
}