
output "dead_lettered_alarm_arn" {
  description = "ARN de la alarma AnalysisDeadLettered > 0"
  value       = aws_cloudwatch_metric_alarm.analysis_dead_lettered.arn
}

output "function_name" {
  value = aws_lambda_function.dlq.function_name
}
