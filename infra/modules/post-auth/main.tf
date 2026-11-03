data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

data "archive_file" "post_auth_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../backend/dist/post-auth"
  output_path = "${path.root}/../backend/dist/post-auth.zip"
}

resource "aws_lambda_function" "post_auth" {
  filename         = data.archive_file.post_auth_zip.output_path
  source_code_hash = data.archive_file.post_auth_zip.output_base64sha256
  function_name    = "${var.project_name}-post-auth-${var.environment}"
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