variable "environment" {
  description = "Alter workload environment."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "account_id" {
  description = "AWS account that owns this environment."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must contain exactly 12 digits."
  }
}

variable "aws_partition" {
  description = "AWS partition used to construct scoped ARNs."
  type        = string

  validation {
    condition     = contains(["aws", "aws-us-gov", "aws-cn"], var.aws_partition)
    error_message = "aws_partition must be a supported AWS partition."
  }
}

variable "aws_region" {
  description = "Alter workload region."
  type        = string

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must be ap-south-1."
  }
}
