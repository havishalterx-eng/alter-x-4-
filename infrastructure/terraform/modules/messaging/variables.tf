variable "environment" {
  description = "Alter workload environment."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "account_id" {
  description = "AWS account that owns messaging and artifacts."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must contain exactly 12 digits."
  }
}

variable "environment_kms_key_arn" {
  description = "Environment KMS key for artifact encryption."
  type        = string
}
