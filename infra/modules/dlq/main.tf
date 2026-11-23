data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

data "archive_file" "dlq_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../backend/dist/dlq"
  output_path = "${path.root}/../backend/dist/dlq.zip"
}

resource "aws_lambda_function" "dlq" {
  filename         = data.archive_file.dlq_zip.output_path
  source_code_hash = data.archive_file.dlq_zip.output_base64sha256
  function_name    = "${var.project_name}-dlq-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      TABLE_NAME = var.dynamodb_table_name
    }
  }
}

resource "aws_lambda_event_source_mapping" "dlq_sqs" {
  event_source_arn = var.dlq_arn
  function_name    = aws_lambda_function.dlq.arn
  batch_size       = 10
}

# NFR-10: alarma sobre la métrica EMF (Arquitectura §4.8). La profundidad de la DLQ no sirve
# porque esta Lambda la vacía casi al instante; la métrica cuenta cada mensaje que llegó.
resource "aws_cloudwatch_metric_alarm" "analysis_dead_lettered" {
  alarm_name          = "${var.project_name}-analysis-dead-lettered-${var.environment}"
  alarm_description   = "Al menos un análisis agotó sus reintentos y cayó en la DLQ (ítem → NEEDS_INPUT)"
  namespace           = "Nudgee"
  metric_name         = "AnalysisDeadLettered"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  # Sin mensajes en la DLQ no hay datos: eso es el estado sano, no "sin datos".
  treat_missing_data = "notBreaching"

  alarm_actions = var.alarm_topic_arn == "" ? [] : [var.alarm_topic_arn]
  ok_actions    = var.alarm_topic_arn == "" ? [] : [var.alarm_topic_arn]
}
