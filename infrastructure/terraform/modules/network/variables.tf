variable "name" {
  description = "Environment name used for resource names and tags."
  type        = string
}

variable "vpc_cidr" {
  description = "Non-overlapping environment VPC CIDR."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be valid IPv4 CIDR notation."
  }
}

variable "availability_zones" {
  description = "At least two availability zones in the configured region."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= 2 && length(distinct(var.availability_zones)) == length(var.availability_zones)
    error_message = "availability_zones must contain at least two unique values."
  }
}

variable "public_subnet_cidrs" {
  description = "One public subnet CIDR per availability zone."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) >= 2 && alltrue([for cidr in var.public_subnet_cidrs : can(cidrhost(cidr, 0))])
    error_message = "public_subnet_cidrs must contain at least two valid CIDRs."
  }
}

variable "private_subnet_cidrs" {
  description = "One private subnet CIDR per availability zone."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidrs) >= 2 && alltrue([for cidr in var.private_subnet_cidrs : can(cidrhost(cidr, 0))])
    error_message = "private_subnet_cidrs must contain at least two valid CIDRs."
  }
}

variable "nat_gateway_strategy" {
  description = "single for cost-sensitive non-production, per_az for resilient production."
  type        = string

  validation {
    condition     = contains(["single", "per_az"], var.nat_gateway_strategy)
    error_message = "nat_gateway_strategy must be single or per_az."
  }
}

variable "kms_key_arn" {
  description = "Same-account KMS key ARN encrypting VPC flow logs."
  type        = string
}

variable "flow_log_retention_days" {
  description = "CloudWatch VPC flow-log retention."
  type        = number

  validation {
    condition     = contains([90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.flow_log_retention_days)
    error_message = "flow_log_retention_days must be a supported CloudWatch retention value of at least 90 days."
  }
}

check "subnet_cardinality" {
  assert {
    condition = (
      length(var.public_subnet_cidrs) == length(var.availability_zones) &&
      length(var.private_subnet_cidrs) == length(var.availability_zones)
    )
    error_message = "Public and private subnet lists must each match availability_zones length."
  }
}

check "subnet_cidrs_unique" {
  assert {
    condition = length(distinct(concat(
      var.public_subnet_cidrs,
      var.private_subnet_cidrs,
    ))) == length(var.public_subnet_cidrs) + length(var.private_subnet_cidrs)
    error_message = "Public and private subnet CIDRs must not be reused."
  }
}
