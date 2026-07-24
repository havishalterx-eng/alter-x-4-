output "secrets_kms_key_arn" {
  description = "Environment-only KMS key for Secrets Manager."
  value       = aws_kms_key.secrets.arn
}

output "system_secrets_policy_arn" {
  description = "IAM policy enforcing the system-secret hierarchy."
  value       = aws_iam_policy.system_secrets.arn
}

output "tenant_integration_secrets_policy_arn" {
  description = "IAM policy enforcing the tenant integration-secret hierarchy."
  value       = aws_iam_policy.tenant_integration_secrets.arn
}

output "appconfig_application_id" {
  description = "AppConfig application identifier."
  value       = aws_appconfig_application.this.id
}

output "appconfig_environment_id" {
  description = "AppConfig environment identifier."
  value       = aws_appconfig_environment.this.environment_id
}

output "appconfig_configuration_profile_id" {
  description = "AppConfig runtime profile identifier."
  value       = aws_appconfig_configuration_profile.runtime.configuration_profile_id
}
