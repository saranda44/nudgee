terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # IMPORTANTE: Reemplaza este valor con el nombre del bucket que arroje el script bootstrap.sh
    bucket = "nudgee-tf-state-529100636555"
    key    = "state/terraform.tfstate"
    region = "us-east-1"

    # Bloqueo nativo en S3 (Terraform 1.10+)
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}