output "lambda_arn" {
  value = aws_lambda_function.post_auth.arn
}

output "function_name" {
  value = aws_lambda_function.post_auth.function_name
}
