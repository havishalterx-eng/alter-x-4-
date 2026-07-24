variable "name" {
  description = "Exact AWS account name."
  type        = string

  validation {
    condition     = startswith(var.name, "alter-")
    error_message = "Account names must use the alter- prefix."
  }
}

variable "email" {
  description = "Unique AWS account email supplied outside version control."
  type        = string

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.email))
    error_message = "email must be syntactically valid."
  }
}

variable "parent_id" {
  description = "Control Tower registered OU ID; null only for the management account import."
  type        = string
  nullable    = true

  validation {
    condition     = var.parent_id == null || can(regex("^(r-[a-z0-9]+|ou-[a-z0-9-]+)$", var.parent_id))
    error_message = "parent_id must be an Organizations root or OU ID when set."
  }
}

variable "purpose" {
  description = "Approved account purpose tag."
  type        = string

  validation {
    condition     = trimspace(var.purpose) != ""
    error_message = "purpose must not be empty."
  }
}

variable "role_name" {
  description = "Organizations bootstrap role name for new member accounts."
  type        = string
  nullable    = true

  validation {
    condition     = var.role_name == null || can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", var.role_name))
    error_message = "role_name must be a valid IAM role name when set."
  }
}
