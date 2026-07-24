variable "environment" {
  description = "Alter workload environment."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "account_id" {
  description = "AWS account that owns the data plane."
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

variable "vpc_id" {
  description = "Environment VPC identifier."
  type        = string
}

variable "vpc_cidr" {
  description = "Environment VPC CIDR permitted to reach private data services."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid CIDR."
  }
}

variable "private_subnet_ids" {
  description = "Private subnet IDs keyed by availability zone."
  type        = map(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "At least two private subnets are required."
  }
}

variable "environment_kms_key_arn" {
  description = "Environment KMS key used for data-at-rest encryption."
  type        = string
}

variable "secrets_kms_key_arn" {
  description = "Environment-only KMS key used by database credential secrets."
  type        = string
}

variable "aurora_engine_version" {
  description = "Aurora PostgreSQL version approved in ap-south-1."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.aurora_engine_version))
    error_message = "aurora_engine_version must be a major.minor version."
  }
}

variable "aurora_parameter_group_family" {
  description = "Aurora PostgreSQL cluster parameter-group family matching the engine version."
  type        = string

  validation {
    condition     = can(regex("^aurora-postgresql[0-9]+$", var.aurora_parameter_group_family))
    error_message = "aurora_parameter_group_family must be an Aurora PostgreSQL family."
  }
}

variable "aurora_min_capacity" {
  description = "Minimum Aurora Serverless v2 ACUs."
  type        = number

  validation {
    condition     = var.aurora_min_capacity >= 0.5
    error_message = "aurora_min_capacity must be at least 0.5 ACU."
  }
}

variable "aurora_max_capacity" {
  description = "Maximum Aurora Serverless v2 ACUs."
  type        = number

  validation {
    condition     = var.aurora_max_capacity >= var.aurora_min_capacity
    error_message = "aurora_max_capacity must not be lower than aurora_min_capacity."
  }
}

variable "backup_retention_days" {
  description = "Aurora automated-backup retention period."
  type        = number

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35."
  }
}

variable "deletion_protection" {
  description = "Protect Aurora clusters from accidental deletion."
  type        = bool
}

variable "redis_engine_version" {
  description = "ElastiCache for Redis engine version."
  type        = string
}

variable "redis_node_type" {
  description = "ElastiCache node type selected for the environment."
  type        = string

  validation {
    condition     = startswith(var.redis_node_type, "cache.")
    error_message = "redis_node_type must be an ElastiCache node type."
  }
}

variable "redis_snapshot_retention_days" {
  description = "Number of days to retain automatic Redis snapshots."
  type        = number

  validation {
    condition     = var.redis_snapshot_retention_days >= 1 && var.redis_snapshot_retention_days <= 35
    error_message = "redis_snapshot_retention_days must be between 1 and 35."
  }
}
