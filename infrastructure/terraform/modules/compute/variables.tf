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

variable "services" {
  description = "Workloads that receive a dedicated security group. grpc_port is required for any service named as a callee in mesh_calls."
  type = map(object({
    grpc_port = optional(number)
  }))
  default = {}

  validation {
    condition = alltrue([
      for name, service in var.services :
      service.grpc_port == null || (service.grpc_port >= 1024 && service.grpc_port <= 65535)
    ])
    error_message = "grpc_port must be an unprivileged TCP port."
  }
}

variable "mesh_calls" {
  description = "Directed service-to-service call graph: callee => set of callers permitted to reach the callee's gRPC port. Anything not listed cannot connect."
  type        = map(set(string))
  default     = {}

  validation {
    condition = alltrue([
      for callee, callers in var.mesh_calls :
      contains(keys(var.services), callee) && try(var.services[callee].grpc_port, null) != null
    ])
    error_message = "Every mesh_calls callee must exist in var.services and declare a grpc_port."
  }

  validation {
    condition = alltrue(flatten([
      for callee, callers in var.mesh_calls : [
        for caller in callers : contains(keys(var.services), caller)
      ]
    ]))
    error_message = "Every mesh_calls caller must exist in var.services."
  }
}
