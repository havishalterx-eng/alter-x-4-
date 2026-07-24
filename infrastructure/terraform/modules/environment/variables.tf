variable "account_name" {
  description = "Exact Alter account name without the alter- prefix for environment resource names."
  type        = string
}

variable "account_id" {
  description = "Target account ID."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must contain exactly 12 digits."
  }
}

variable "purpose" {
  description = "Exact approved account purpose."
  type        = string
}

variable "aws_partition" {
  description = "AWS partition."
  type        = string
}

variable "aws_region" {
  description = "AWS home region."
  type        = string

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must be ap-south-1."
  }
}

variable "budget_limit_usd" {
  description = "Monthly account budget limit in USD."
  type        = number

  validation {
    condition     = var.budget_limit_usd > 0
    error_message = "budget_limit_usd must be positive."
  }
}

variable "budget_alert_thresholds" {
  description = "Forecast percentage thresholds that trigger budget email alerts."
  type        = list(number)

  validation {
    condition = (
      length(var.budget_alert_thresholds) >= 2 &&
      length(var.budget_alert_thresholds) <= 5 &&
      alltrue([for threshold in var.budget_alert_thresholds : threshold > 0 && threshold <= 200])
    )
    error_message = "Provide two to five percentage thresholds between 0 and 200."
  }
}

variable "budget_alert_email" {
  description = "Distribution-list email receiving account budget alerts."
  type        = string

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.budget_alert_email))
    error_message = "budget_alert_email must be syntactically valid."
  }
}

variable "create_ci_role" {
  description = "Whether this account receives a shared-services CI deployment role."
  type        = bool
}

variable "ci_principal_arn" {
  description = "Exact shared-services CI principal ARN trusted to assume the deployment role."
  type        = string
  nullable    = true
}

variable "ci_external_id" {
  description = "External ID required when shared-services CI assumes the deployment role."
  type        = string
  nullable    = true
  sensitive   = true
}

variable "deployment_actions" {
  description = "Exact least-privilege deployment actions; service-wide wildcards are rejected."
  type        = set(string)

  validation {
    condition = alltrue([
      for action in var.deployment_actions : action != "*" && !endswith(action, ":*")
    ])
    error_message = "deployment_actions must not contain global or service-wide wildcards."
  }
}

variable "deployment_resource_arns" {
  description = "Exact resources CI may deploy; global wildcard resources are rejected."
  type        = set(string)

  validation {
    condition     = alltrue([for resource in var.deployment_resource_arns : resource != "*"])
    error_message = "deployment_resource_arns must not contain a global wildcard."
  }
}

variable "global_deployment_actions" {
  description = "Narrow allowlist of AWS APIs that technically require Resource '*'."
  type        = set(string)

  validation {
    condition = length(setsubtract(
      var.global_deployment_actions,
      toset([
        "ecr:GetAuthorizationToken",
        "ecs:RegisterTaskDefinition",
      ]),
    )) == 0
    error_message = "Only ecr:GetAuthorizationToken and ecs:RegisterTaskDefinition are approved as global deployment actions."
  }
}

variable "network" {
  description = "Optional Multi-AZ VPC configuration for accounts that run workloads or shared services."
  type = object({
    vpc_cidr                = string
    availability_zones      = list(string)
    public_subnet_cidrs     = list(string)
    private_subnet_cidrs    = list(string)
    nat_gateway_strategy    = string
    flow_log_retention_days = number
  })
  nullable = true
}
