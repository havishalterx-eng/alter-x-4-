variable "environment" {
  description = "Alter environment receiving its own ECS cluster."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod", "sandbox-exec"], var.environment)
    error_message = "environment must be dev, staging, prod, or sandbox-exec."
  }
}

variable "environment_kms_key_arn" {
  description = "Environment KMS key used for ECS execute-command logs."
  type        = string
}

variable "vpc_id" {
  description = "VPC containing the dedicated ADS Client workload security group."
  type        = string
}
