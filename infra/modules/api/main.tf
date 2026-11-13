# Learner Lab no permite crear roles IAM: la Lambda usa LabRole, igual que los demás módulos.
data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

# Crear ZIP de la Lambda API sobre la marcha
data "archive_file" "api_lambda" {
  type        = "zip"
  source_file = var.lambda_index_path
  output_path = "${path.module}/../../dist/api.zip"
}

# Lambda API
resource "aws_lambda_function" "api" {
  filename      = data.archive_file.api_lambda.output_path
  function_name = "${var.project_name}-api-${var.environment}"
  role          = data.aws_iam_role.lab_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.lambda_timeout
  memory_size   = 512

  environment {
    variables = {
      TABLE_NAME            = var.dynamodb_table_name
      VAPID_PUBLIC_KEY      = var.vapid_public_key
      NODE_ENV              = var.environment
      DISPATCHER_LAMBDA_ARN = var.dispatcher_lambda_arn
      SCHEDULER_ROLE_ARN    = var.scheduler_role_arn
    }
  }

  source_code_hash = data.archive_file.api_lambda.output_base64sha256

  tags = var.tags
}

# Log Group
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 7

  tags = var.tags
}
