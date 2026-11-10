data "aws_caller_identity" "current" {}

# Crear ZIP de la Lambda Dispatcher sobre la marcha
data "archive_file" "dispatcher_lambda" {
  type        = "zip"
  source_file = var.lambda_index_path
  output_path = "${path.module}/../../dist/dispatcher.zip"
}

# IAM Role para la Lambda Dispatcher
resource "aws_iam_role" "dispatcher_role" {
  name = "${var.project_name}-dispatcher-role-${var.environment}"

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
resource "aws_iam_role_policy" "dispatcher_logs" {
  name = "${var.project_name}-dispatcher-logs-${var.environment}"
  role = aws_iam_role.dispatcher_role.id

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
resource "aws_iam_role_policy" "dispatcher_dynamodb" {
  name = "${var.project_name}-dispatcher-dynamodb-${var.environment}"
  role = aws_iam_role.dispatcher_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
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
resource "aws_iam_role_policy" "dispatcher_ssm" {
  name = "${var.project_name}-dispatcher-ssm-${var.environment}"
  role = aws_iam_role.dispatcher_role.id

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

# Lambda Dispatcher
resource "aws_lambda_function" "dispatcher" {
  filename      = data.archive_file.dispatcher_lambda.output_path
  function_name = "${var.project_name}-dispatcher-${var.environment}"
  role          = aws_iam_role.dispatcher_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.lambda_timeout
  memory_size   = 512

  environment {
    variables = {
      TABLE_NAME               = var.dynamodb_table_name
      VAPID_PUBLIC_KEY         = var.vapid_public_key
      NOTIFICATION_TTL_DAYS    = var.notification_ttl_days
      NODE_ENV                 = var.environment
    }
  }

  source_code_hash = data.archive_file.dispatcher_lambda.output_base64sha256

  tags = var.tags

  depends_on = [
    aws_iam_role_policy.dispatcher_logs,
    aws_iam_role_policy.dispatcher_dynamodb,
    aws_iam_role_policy.dispatcher_ssm
  ]
}

# Log Group
resource "aws_cloudwatch_log_group" "dispatcher" {
  name              = "/aws/lambda/${aws_lambda_function.dispatcher.function_name}"
  retention_in_days = 7

  tags = var.tags
}

# IAM Role para EventBridge Scheduler (invoca Dispatcher)
resource "aws_iam_role" "scheduler_role" {
  name = "${var.project_name}-scheduler-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

# Policy: Scheduler puede invocar la Lambda Dispatcher
resource "aws_iam_role_policy" "scheduler_invoke_dispatcher" {
  name = "${var.project_name}-scheduler-invoke-dispatcher-${var.environment}"
  role = aws_iam_role.scheduler_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          aws_lambda_function.dispatcher.arn,
          "${aws_lambda_function.dispatcher.arn}:*"
        ]
      }
    ]
  })
}
