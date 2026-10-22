output "table_name" {
  description = "El nombre de la tabla de DynamoDB"
  value       = aws_dynamodb_table.main.name
}

output "table_arn" {
  description = "El ARN de la tabla de DynamoDB"
  value       = aws_dynamodb_table.main.arn
}