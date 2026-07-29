output "control_plane_cluster_arn" {
  description = "Control-plane Aurora cluster ARN."
  value       = aws_rds_cluster.control_plane.arn
}

output "ads_cluster_arn" {
  description = "Separate ADS Aurora cluster ARN."
  value       = aws_rds_cluster.ads.arn
}

output "ads_cluster_endpoint" {
  description = "Writer endpoint for the separate ADS Aurora cluster."
  value       = aws_rds_cluster.ads.endpoint
}

output "ads_cluster_reader_endpoint" {
  description = "Reader endpoint for the separate ADS Aurora cluster."
  value       = aws_rds_cluster.ads.reader_endpoint
}

output "ads_database_credentials_secret_arn" {
  description = "ADS Core credential-container secret ARN."
  value       = aws_secretsmanager_secret.ads_database_credentials.arn
}

output "redis_replication_group_id" {
  description = "Private ElastiCache replication-group identifier."
  value       = aws_elasticache_replication_group.redis.id
}

output "database_contract" {
  description = "One-service-per-database contract with distinct secret and IAM boundaries."
  value = {
    for database_name, owner in local.database_catalog : database_name => {
      owner                 = owner
      secret_path           = local.database_secret_paths[database_name]
      secret_arn_pattern    = local.database_secret_arn_patterns[database_name]
      database_user         = local.database_user_names[database_name]
      access_policy_arn     = aws_iam_policy.database_access[database_name].arn
      credential_secret_arn = aws_secretsmanager_secret.database_credentials[database_name].arn
    }
  }
}

output "database_access_policy_documents" {
  description = "Policy documents exposed for the database-separation contract test."
  value       = { for database_name, policy in aws_iam_policy.database_access : database_name => policy.policy }
}

output "database_access_contract" {
  description = "Deterministic one-secret and one-database-user grant per owning service."
  value = {
    for database_name, owner in local.database_catalog : database_name => {
      owner            = owner
      secret_resources = [local.database_secret_arn_patterns[database_name]]
      database_users   = [local.database_user_names[database_name]]
    }
  }
}
