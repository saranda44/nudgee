output "lambda_arn" {
  value = aws_lambda_function.worker_ia.arn
}

output "function_name" {
  value = aws_lambda_function.worker_ia.function_name
}
