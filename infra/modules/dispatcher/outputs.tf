output "lambda_arn" {
  value       = aws_lambda_function.dispatcher.arn
  description = "ARN de la Lambda Dispatcher"
}

output "function_name" {
  value       = aws_lambda_function.dispatcher.function_name
  description = "Nombre de la función Lambda Dispatcher"
}

output "scheduler_role_arn" {
  value       = aws_iam_role.scheduler_role.arn
  description = "ARN del IAM role para EventBridge Scheduler (usar en E-04)"
}

output "dispatcher_lambda_arn" {
  value       = aws_lambda_function.dispatcher.arn
  description = "ARN para que E-04 use en CreateSchedule"
}
