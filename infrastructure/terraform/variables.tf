variable "aws_region" {
  description = "AWS Control Tower home region and only workload region."
  type        = string

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must be ap-south-1."
  }
}

variable "management_account_id" {
  description = "Existing AWS Organizations management account ID."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.management_account_id))
    error_message = "management_account_id must contain exactly 12 digits."
  }
}

variable "management_role_arn" {
  description = "Role ARN Terraform assumes in the management account."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:iam::[0-9]{12}:role/.+$", var.management_role_arn))
    error_message = "management_role_arn must be an IAM role ARN."
  }
}

variable "mock_provider" {
  description = "Disables AWS credential and account lookups for offline validation only. Must be false for real plans."
  type        = bool
}

variable "enable_existing_account_imports" {
  description = "Imports Control Tower-created accounts when true; false is reserved for offline mocked plans."
  type        = bool
}

variable "existing_account_ids" {
  description = "Account IDs already created by the management account or Control Tower and imported into this stack."
  type        = map(string)

  validation {
    condition = alltrue([
      for name, account_id in var.existing_account_ids :
      contains(["alter-management", "alter-log-archive", "alter-security"], name) && can(regex("^[0-9]{12}$", account_id))
    ])
    error_message = "existing_account_ids may contain only the three Control Tower prerequisite accounts and 12-digit IDs."
  }
}

variable "account_role_name" {
  description = "Bootstrap role name created by AWS Organizations in new member accounts."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", var.account_role_name))
    error_message = "account_role_name must be a valid IAM role name."
  }
}

variable "accounts" {
  description = "Exact eight-account catalog. Emails and OU parent IDs are supplied outside version control."
  type = map(object({
    email     = string
    parent_id = optional(string)
    purpose   = string
  }))

  validation {
    condition = length(setsubtract(
      toset(keys(var.accounts)),
      toset([
        "alter-management",
        "alter-log-archive",
        "alter-security",
        "alter-shared-services",
        "alter-dev",
        "alter-staging",
        "alter-prod",
        "alter-sandbox-exec",
      ])
      )) == 0 && length(setsubtract(
      toset([
        "alter-management",
        "alter-log-archive",
        "alter-security",
        "alter-shared-services",
        "alter-dev",
        "alter-staging",
        "alter-prod",
        "alter-sandbox-exec",
      ]),
      toset(keys(var.accounts))
    )) == 0
    error_message = "accounts must contain exactly the eight required Alter account names."
  }

  validation {
    condition = alltrue([
      for account in values(var.accounts) :
      can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", account.email))
    ])
    error_message = "Every account email must be syntactically valid."
  }
}

variable "scp_target_ids" {
  description = "OU or account targets grouped by policy strength after Control Tower enrollment."
  type = object({
    baseline   = set(string)
    production = set(string)
    sandbox    = set(string)
  })

  validation {
    condition = alltrue(flatten([
      for targets in [var.scp_target_ids.baseline, var.scp_target_ids.production, var.scp_target_ids.sandbox] : [
        for target in targets : can(regex("^(ou-[a-z0-9-]+|[0-9]{12})$", target))
      ]
    ]))
    error_message = "SCP targets must be OU IDs or 12-digit account IDs."
  }
}

variable "environment_vpc_cidrs" {
  description = "Cross-stack CIDR catalog used to prevent future peering or transit collisions."
  type        = map(string)

  validation {
    condition = (
      length(setsubtract(
        toset(keys(var.environment_vpc_cidrs)),
        toset(["shared-services", "dev", "staging", "prod", "sandbox-exec"]),
        )) == 0 && length(setsubtract(
        toset(["shared-services", "dev", "staging", "prod", "sandbox-exec"]),
        toset(keys(var.environment_vpc_cidrs)),
        )) == 0 && alltrue([
        for cidr in values(var.environment_vpc_cidrs) :
        can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$", cidr)) &&
        can(cidrhost(cidr, 0))
      ])
    )
    error_message = "environment_vpc_cidrs must contain exactly the five networked accounts with valid CIDRs."
  }
}

variable "break_glass_role_arns" {
  description = "Audited break-glass IAM role ARNs exempted only from production KMS lockout guards."
  type        = set(string)

  validation {
    condition = length(var.break_glass_role_arns) > 0 && alltrue([
      for role_arn in var.break_glass_role_arns : can(regex("^arn:[^:]+:iam::[0-9]{12}:role/.+$", role_arn))
    ])
    error_message = "At least one valid break-glass IAM role ARN is required."
  }
}

variable "root_principal_arn_pattern" {
  description = "Partition-aware IAM root principal ARN pattern used by the root-user SCP."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:iam::\\*:root$", var.root_principal_arn_pattern))
    error_message = "root_principal_arn_pattern must target IAM root principals with a wildcard account segment."
  }
}
