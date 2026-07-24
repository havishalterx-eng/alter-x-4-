variable "name" {
  description = "SCP name."
  type        = string
}

variable "description" {
  description = "SCP purpose."
  type        = string
}

variable "policy" {
  description = "Complete SCP JSON document."
  type        = string

  validation {
    condition     = can(jsondecode(var.policy))
    error_message = "policy must contain valid JSON."
  }
}

variable "target_ids" {
  description = "Organization root, OU, or account IDs receiving this SCP."
  type        = set(string)

  validation {
    condition     = length(var.target_ids) > 0
    error_message = "At least one SCP target is required."
  }
}
