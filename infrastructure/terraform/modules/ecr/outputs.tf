output "repository_urls" {
  description = "Exact backend-service ECR repository URLs."
  value       = { for service, repository in aws_ecr_repository.service : service => repository.repository_url }
}
