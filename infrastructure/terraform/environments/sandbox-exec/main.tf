terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers { aws = { source = "hashicorp/aws", version = "= 6.53.0" } }
  backend "local" { path = "../../state/sandbox-exec.tfstate" }
}
variable "aws_region" { type = string }
variable "aws_partition" { type = string }
variable "mock_provider" { type = bool }
variable "configuration" {
  type = object({
    account_id = string, target_role_arn = string
    budget     = object({ limit_usd = number, thresholds = list(number), alert_email = string })
    ci         = object({ principal_arn = string, external_id = string, actions = set(string), global_actions = set(string), resource_arns = set(string) })
    network    = object({ vpc_cidr = string, availability_zones = list(string), public_subnet_cidrs = list(string), private_subnet_cidrs = list(string), nat_gateway_strategy = string, flow_log_retention_days = number })
  })
}
check "configuration" {
  assert {
    condition     = var.aws_region == "ap-south-1" && can(regex("^[0-9]{12}$", var.configuration.account_id)) && can(regex("^arn:[^:]+:iam::[0-9]{12}:role/.+$", var.configuration.target_role_arn)) && alltrue([for az in var.configuration.network.availability_zones : startswith(az, var.aws_region)])
    error_message = "Region, account ID, target role ARN, or availability zones are invalid."
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
      session_name = "alter-sandbox-exec-terraform"
    }
  }
  default_tags { tags = { ManagedBy = "terraform", Project = "alterx", Account = "alter-sandbox-exec" } }
}
module "environment" {
  source                    = "../../modules/environment"
  account_name              = "sandbox-exec"
  account_id                = var.configuration.account_id
  purpose                   = "High-risk browser + code-execution workloads, external sandbox-provider integration. Separate blast radius from control plane."
  aws_partition             = var.aws_partition
  aws_region                = var.aws_region
  budget_limit_usd          = var.configuration.budget.limit_usd
  budget_alert_thresholds   = var.configuration.budget.thresholds
  budget_alert_email        = var.configuration.budget.alert_email
  create_ci_role            = true
  ci_principal_arn          = var.configuration.ci.principal_arn
  ci_external_id            = var.configuration.ci.external_id
  deployment_actions        = var.configuration.ci.actions
  global_deployment_actions = var.configuration.ci.global_actions
  deployment_resource_arns  = var.configuration.ci.resource_arns
  network                   = var.configuration.network
}

module "compute" {
  source = "../../modules/compute"

  environment             = "sandbox-exec"
  environment_kms_key_arn = module.environment.kms_key_arn
}

output "kms_key_arn" { value = module.environment.kms_key_arn }
output "ci_deployment_role_arn" { value = module.environment.ci_deployment_role_arn }
output "vpc_id" { value = module.environment.vpc_id }
output "ecs_cluster_arn" { value = module.compute.cluster_arn }
