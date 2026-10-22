# Dead Letter Queue (DLQ) FIFO
resource "aws_sqs_queue" "dlq" {
  name                        = "${var.project_name}-analysis-dlq-${var.environment}.fifo"
  fifo_queue                  = true
  content_based_deduplication = false

  tags = var.tags
}

# Cola principal FIFO
resource "aws_sqs_queue" "main" {
  name                        = "${var.project_name}-analysis-${var.environment}.fifo"
  fifo_queue                  = true
  content_based_deduplication = false

  # 360 segundos (6x el timeout del worker)
  visibility_timeout_seconds = 360

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })

  tags = var.tags
}