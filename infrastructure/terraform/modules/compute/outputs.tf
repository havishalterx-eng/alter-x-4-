output "cluster_arn" {
  description = "Environment-specific ECS Fargate cluster ARN."
  value       = aws_ecs_cluster.this.arn
}

output "ads_client_security_group_id" {
  description = "Dedicated source security group allowed to reach ADS Aurora."
  value       = aws_security_group.ads_client.id
}
