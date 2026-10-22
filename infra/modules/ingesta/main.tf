data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

data "archive_file" "ingesta_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../backend/dist/ingesta"
  output_path = "${path.root}/../backend/dist/ingesta.zip"
}

resource "aws_lambda_function" "ingesta" {
  filename         = data.archive_file.ingesta_zip.output_path
  source_code_hash = data.archive_file.ingesta_zip.output_base64sha256
  function_name    = "${var.project_name}-ingesta-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 512

  environment {
    variables = {
      TABLE_NAME = var.dynamodb_table_name
      QUEUE_URL  = var.sqs_queue_url
    }
  }
}