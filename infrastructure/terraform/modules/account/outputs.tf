output "account_id" {
  description = "AWS Organizations account ID."
  value       = aws_organizations_account.this.id
}

output "account_arn" {
  description = "AWS Organizations account ARN."
  value       = aws_organizations_account.this.arn
}
