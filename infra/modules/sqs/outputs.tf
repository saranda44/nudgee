output "queue_url" {
  description = "URL de la cola SQS principal"
  value       = aws_sqs_queue.main.id
}

output "queue_arn" {
  description = "ARN de la cola SQS principal"
  value       = aws_sqs_queue.main.arn
}

output "dlq_url" {
  description = "URL de la DLQ"
  value       = aws_sqs_queue.dlq.id
}