variable "name" {
  description = "Service name; must match the key used in modules/compute var.services so the correct security group is attached."
  type        = string
}

variable "environment_name" {
  description = "Alter environment this service runs in."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod", "sandbox-exec"], var.environment_name)
    error_message = "environment_name must be dev, staging, prod, or sandbox-exec."
  }
}

variable "aws_region" {
  description = "Region for the awslogs driver."
  type        = string

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must be ap-south-1."
  }
}

variable "cluster_arn" {
  description = "ECS cluster ARN from modules/compute."
  type        = string
}

variable "security_group_id" {
  description = "Per-service security group from modules/compute service_security_group_ids. Determines who may reach this task."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs. Public subnets are rejected: workloads must not be internet-addressable."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "At least two private subnets are required for AZ resilience."
  }
}

variable "image" {
  description = "Fully qualified container image, pinned by digest (name@sha256:...) so a moved tag cannot change what runs."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be pinned by digest, e.g. repo/name@sha256:<64 hex>."
  }
}

variable "container_port" {
  description = "Listener port, or null for a worker with no inbound listener (e.g. background-workers)."
  type        = number
  default     = null

  validation {
    condition     = var.container_port == null || (var.container_port >= 1024 && var.container_port <= 65535)
    error_message = "container_port must be an unprivileged TCP port."
  }
}

variable "environment" {
  description = "Non-secret configuration. Anything sensitive belongs in var.secrets."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secret references: name => Secrets Manager or SSM Parameter ARN. Values are resolved by the ECS agent and never stored in the task definition."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for name, arn in var.secrets : can(regex("^arn:[^:]+:(secretsmanager|ssm):", arn))
    ])
    error_message = "Every secret must be a Secrets Manager or SSM Parameter Store ARN, not a literal value."
  }
}

variable "execution_role_arn" {
  description = "Task execution role: pulls the image and resolves var.secrets."
  type        = string
}

variable "task_role_arn" {
  description = "Task role: the application's own AWS identity. Scope per service; do not share one role across services."
  type        = string
}

variable "cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 1024
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture."
  type        = string
  default     = "ARM64"

  validation {
    condition     = contains(["ARM64", "X86_64"], var.cpu_architecture)
    error_message = "cpu_architecture must be ARM64 or X86_64."
  }
}

variable "container_user" {
  description = "Non-root uid:gid the container runs as."
  type        = string
  default     = "10001:10001"

  validation {
    condition     = var.container_user != "0" && !startswith(var.container_user, "0:")
    error_message = "container_user must not be root."
  }
}

variable "desired_count" {
  description = "Task count. Ignored on subsequent applies so autoscaling owns it."
  type        = number
  default     = 2
}

variable "enable_execute_command" {
  description = "Enable ECS exec (interactive shell into a running task). Must stay false in prod."
  type        = bool
  default     = false

  validation {
    condition     = !(var.enable_execute_command && var.environment_name == "prod")
    error_message = "enable_execute_command must be false in prod."
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 365
}

variable "health_check_command" {
  description = "Optional container health check, e.g. [\"CMD-SHELL\", \"curl -fsS http://localhost:3000/health || exit 1\"]."
  type        = list(string)
  default     = null
}

variable "environment_kms_key_arn" {
  description = "Environment KMS key used to encrypt the service log group."
  type        = string
}
