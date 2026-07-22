output "policy_id" {
  description = "Organizations SCP policy ID."
  value       = aws_organizations_policy.this.id
}
