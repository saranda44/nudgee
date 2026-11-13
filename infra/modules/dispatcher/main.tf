# Learner Lab no permite crear roles IAM: la Lambda y EventBridge Scheduler usan LabRole
# (su trust policy incluye lambda.amazonaws.com y scheduler.amazonaws.com).
data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

# Crear ZIP de la Lambda Dispatcher sobre la marcha
data "archive_file" "dispatcher_lambda" {
  type        = "zip"
  source_file = var.lambda_index_path
  output_path = "${path.module}/../../dist/dispatcher.zip"
}

# Lambda Dispatcher
resource "aws_lambda_function" "dispatcher" {
  filename      = data.archive_file.dispatcher_lambda.output_path
  function_name = "${var.project_name}-dispatcher-${var.environment}"
  role          = data.aws_iam_role.lab_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.lambda_timeout
  memory_size   = 512

  environment {
    variables = {
      TABLE_NAME            = var.dynamodb_table_name
      VAPID_PUBLIC_KEY      = var.vapid_public_key
      NOTIFICATION_TTL_DAYS = var.notification_ttl_days
      NODE_ENV              = var.environment
    }
  }

  source_code_hash = data.archive_file.dispatcher_lambda.output_base64sha256

  tags = var.tags
}

# Log Group
resource "aws_cloudwatch_log_group" "dispatcher" {
  name              = "/aws/lambda/${aws_lambda_function.dispatcher.function_name}"
  retention_in_days = 7

  tags = var.tags
}
