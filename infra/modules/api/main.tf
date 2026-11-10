data "aws_caller_identity" "current" {}

# Crear ZIP de la Lambda API sobre la marcha
data "archive_file" "api_lambda" {
  type        = "zip"
  source_file = var.lambda_index_path
  output_path = "${path.module}/../../dist/api.zip"
}

# IAM Role para la Lambda API
resource "aws_iam_role" "api_role" {
  name = "${var.project_name}-api-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

# Policy: Logs
resource "aws_iam_role_policy" "api_logs" {
  name = "${var.project_name}-api-logs-${var.environment}"
  role = aws_iam_role.api_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:*"
      }
    ]
  })
}

# Policy: DynamoDB (read/write)
resource "aws_iam_role_policy" "api_dynamodb" {
  name = "${var.project_name}-api-dynamodb-${var.environment}"
  role = aws_iam_role.api_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:Scan"
        ]
        Resource = [
          var.dynamodb_table_arn,
          "${var.dynamodb_table_arn}/index/*"
        ]
      }
    ]
  })
}

# Policy: SSM GetParameter (VAPID keys)
resource "aws_iam_role_policy" "api_ssm" {
  name = "${var.project_name}-api-ssm-${var.environment}"
  role = aws_iam_role.api_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter"
        ]
        Resource = "arn:aws:ssm:*:${data.aws_caller_identity.current.account_id}:parameter/nudgee/*"
      }
    ]
  })
}

# Policy: EventBridge Scheduler (E-04 para crear/actualizar schedules)
resource "aws_iam_role_policy" "api_scheduler" {
  name = "${var.project_name}-api-scheduler-${var.environment}"
  role = aws_iam_role.api_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule"
        ]
        Resource = "arn:aws:scheduler:*:${data.aws_caller_identity.current.account_id}:schedule/nudgee-reminders/nudgee-*"
      }
    ]
  })
}

# Lambda API
resource "aws_lambda_function" "api" {
  filename      = data.archive_file.api_lambda.output_path
  function_name = "${var.project_name}-api-${var.environment}"
  role          = aws_iam_role.api_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.lambda_timeout
  memory_size   = 512

  environment {
    variables = {
      TABLE_NAME           = var.dynamodb_table_name
      VAPID_PUBLIC_KEY     = var.vapid_public_key
      NODE_ENV             = var.environment
      DISPATCHER_LAMBDA_ARN = var.dispatcher_lambda_arn
      SCHEDULER_ROLE_ARN   = var.scheduler_role_arn
    }
  }

  source_code_hash = data.archive_file.api_lambda.output_base64sha256

  tags = var.tags

  depends_on = [
    aws_iam_role_policy.api_logs,
    aws_iam_role_policy.api_dynamodb,
    aws_iam_role_policy.api_ssm,
    aws_iam_role_policy.api_scheduler
  ]
}

# Log Group
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 7

  tags = var.tags
}
