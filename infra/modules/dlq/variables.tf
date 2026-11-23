variable "project_name" { type = string }
variable "environment" { type = string }
variable "dynamodb_table_name" { type = string }
variable "dlq_arn" { type = string }
variable "alarm_topic_arn" {
  description = "Topic SNS para notificar la alarma; vacío = la alarma existe pero no avisa"
  type        = string
  default     = ""
}
