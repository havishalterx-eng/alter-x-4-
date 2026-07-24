terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers { aws = { source = "hashicorp/aws", version = "= 6.53.0" } }
  backend "local" { path = "../../state/log-archive.tfstate" }
}
variable "aws_region" { type = string }
variable "aws_partition" { type = string }
variable "mock_provider" { type = bool }
variable "configuration" {
  type = object({
    account_id = string, target_role_arn = string
    budget     = object({ limit_usd = number, thresholds = list(number), alert_email = string })
    ci         = optional(object({ principal_arn = string, external_id = string, actions = set(string), global_actions = set(string), resource_arns = set(string) }))
    network    = optional(object({ vpc_cidr = string, availability_zones = list(string), public_subnet_cidrs = list(string), private_subnet_cidrs = list(string), nat_gateway_strategy = string, flow_log_retention_days = number }))
  })
}
check "configuration" {
  assert {
    condition     = var.aws_region == "ap-south-1" && can(regex("^[0-9]{12}$", var.configuration.account_id)) && can(regex("^arn:[^:]+:iam::[0-9]{12}:role/.+$", var.configuration.target_role_arn))
    error_message = "Region, account ID, or target role ARN is invalid."
  }
}
provider "aws" {
  region                      = var.aws_region
  allowed_account_ids         = var.mock_provider ? null : [var.configuration.account_id]
  skip_credentials_validation = var.mock_provider
  skip_metadata_api_check     = var.mock_provider
  skip_requesting_account_id  = var.mock_provider
  dynamic "assume_role" {
    for_each = var.mock_provider ? [] : [var.configuration.target_role_arn]
    content {
      role_arn     = assume_role.value
      session_name = "alter-log-archive-terraform"
    }
  }
  default_tags { tags = { ManagedBy = "terraform", Project = "alterx", Account = "alter-log-archive" } }
}
module "environment" {
  source                    = "../../modules/environment"
  account_name              = "log-archive"
  account_id                = var.configuration.account_id
  purpose                   = "Central CloudTrail, AWS Config, immutable security logs"
  aws_partition             = var.aws_partition
  aws_region                = var.aws_region
  budget_limit_usd          = var.configuration.budget.limit_usd
  budget_alert_thresholds   = var.configuration.budget.thresholds
  budget_alert_email        = var.configuration.budget.alert_email
  create_ci_role            = false
  ci_principal_arn          = null
  ci_external_id            = null
  deployment_actions        = []
  global_deployment_actions = []
  deployment_resource_arns  = []
  network                   = null
}
output "kms_key_arn" { value = module.environment.kms_key_arn }
