data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

data "archive_file" "worker_ia_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../backend/dist/worker-ia"
  output_path = "${path.root}/../backend/dist/worker-ia.zip"
}

resource "aws_lambda_function" "worker_ia" {
  filename         = data.archive_file.worker_ia_zip.output_path
  source_code_hash = data.archive_file.worker_ia_zip.output_base64sha256
  function_name    = "${var.project_name}-worker-ia-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 512

  environment {
    variables = {
      TABLE_NAME                    = var.dynamodb_table_name
      QUEUE_URL                     = var.sqs_queue_url
      GEMINI_MODEL                  = var.gemini_model
      ANALYSIS_VERSION              = tostring(var.analysis_version)
      CACHE_CONFIDENCE_THRESHOLD    = tostring(var.cache_confidence_threshold)
      CACHE_TTL_OK_SECONDS          = tostring(var.cache_ttl_ok_seconds)
      CACHE_TTL_UNAVAILABLE_SECONDS = tostring(var.cache_ttl_unavailable_seconds)
      GEMINI_TIMEOUT_MS             = tostring(var.gemini_timeout_ms)
    }
  }
}

# concurrencia máxima del event source mapping (no reserved concurrency),
# para no rebasar la cuota gratuita de Gemini.
resource "aws_lambda_event_source_mapping" "worker_ia_sqs" {
  event_source_arn = var.sqs_queue_arn
  function_name    = aws_lambda_function.worker_ia.arn
  batch_size       = 1

  scaling_config {
    maximum_concurrency = 2
  }
}
