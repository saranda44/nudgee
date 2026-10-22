output "lambda_arn" {
  value = aws_lambda_function.ingesta.arn
}

output "lambda_invoke_arn" {
  value = aws_lambda_function.ingesta.invoke_arn
}