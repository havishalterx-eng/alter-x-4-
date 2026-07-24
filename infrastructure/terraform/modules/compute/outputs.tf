output "cluster_arn" {
  description = "Environment-specific ECS Fargate cluster ARN."
  value       = aws_ecs_cluster.this.arn
}
