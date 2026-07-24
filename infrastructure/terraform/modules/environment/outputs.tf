output "kms_key_arn" {
  description = "Environment-scoped KMS key ARN."
  value       = aws_kms_key.environment.arn
}

output "ci_deployment_role_arn" {
  description = "Cross-account CI deployment role ARN when enabled."
  value       = var.create_ci_role ? aws_iam_role.ci_deployment[0].arn : null
}

output "vpc_id" {
  description = "Environment VPC ID when networking is enabled."
  value       = var.network == null ? null : module.network[0].vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs keyed by availability zone when networking is enabled."
  value       = var.network == null ? {} : module.network[0].private_subnet_ids
}
