terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.53.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  allowed_account_ids         = var.mock_provider ? null : [var.management_account_id]
  skip_credentials_validation = var.mock_provider
  skip_metadata_api_check     = var.mock_provider
  skip_requesting_account_id  = var.mock_provider

  dynamic "assume_role" {
    for_each = var.mock_provider ? [] : [var.management_role_arn]
    content {
      role_arn     = assume_role.value
      session_name = "alter-landing-zone-terraform"
    }
  }

  default_tags {
    tags = {
      ManagedBy = "terraform"
      Project   = "alterx"
      Stack     = "landing-zone"
    }
  }
}
