output "lambda_arn" {
  value       = aws_lambda_function.api.arn
  description = "ARN de la Lambda API"
}

output "lambda_invoke_arn" {
  value       = aws_lambda_function.api.invoke_arn
  description = "ARN para invocar la Lambda API"
}

output "function_name" {
  value       = aws_lambda_function.api.function_name
  description = "Nombre de la función Lambda"
}

output "role_arn" {
  value       = data.aws_iam_role.lab_role.arn
  description = "ARN del IAM role de la Lambda (LabRole)"
}
