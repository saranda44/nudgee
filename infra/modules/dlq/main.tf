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
  runtime          = "nodejs20.x"
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
