locals {
  database_catalog = {
    platform_db      = "platform-api"
    orchestration_db = "orchestration-service"
    intelligence_db  = "intelligence-service"
    policy_db        = "memory-policy-service"
    cost_db          = "cost-ledger-service"
    eval_db          = "eval-service"
    audit_db         = "audit-service"
  }

  database_secret_paths = {
    for database_name, owner in local.database_catalog :
    database_name => "/alter/${var.environment}/${owner}/system/database_credentials"
  }
  database_secret_arn_patterns = {
    for database_name, path in local.database_secret_paths :
    database_name => "arn:${var.aws_partition}:secretsmanager:${var.aws_region}:${var.account_id}:secret:${path}-*"
  }
  database_user_names = {
    for database_name, owner in local.database_catalog :
    database_name => replace(owner, "-", "_")
  }
  availability_zones = sort(keys(var.private_subnet_ids))
}

check "database_separation_contract" {
  assert {
    condition = (
      length(local.database_catalog) == 7 &&
      length(distinct(values(local.database_catalog))) == 7 &&
      length(distinct(values(local.database_secret_paths))) == 7
    )
    error_message = "The control-plane database catalog must contain seven owners with seven distinct secret paths."
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "alter-${var.environment}-data"
  subnet_ids = sort(values(var.private_subnet_ids))

  tags = {
    Name        = "alter-${var.environment}-data"
    Environment = var.environment
    Tier        = "private"
  }
}

resource "aws_security_group" "postgres" {
  name_prefix = "alter-${var.environment}-postgres-"
  description = "Aurora PostgreSQL access from the environment VPC only."
  vpc_id      = var.vpc_id

  tags = {
    Name        = "alter-${var.environment}-postgres"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  security_group_id = aws_security_group.postgres.id
  description       = "PostgreSQL from private environment workloads"
  cidr_ipv4         = var.vpc_cidr
  from_port         = 5432
  ip_protocol       = "tcp"
  to_port           = 5432
}

resource "aws_rds_cluster_parameter_group" "postgres" {
  name        = "alter-${var.environment}-aurora-postgresql"
  family      = var.aurora_parameter_group_family
  description = "Require encrypted PostgreSQL connections for Alter ${var.environment}."

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_statement"
    value = "ddl"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = {
    Environment = var.environment
  }
}

resource "aws_rds_cluster" "control_plane" {
  cluster_identifier                  = "alter-${var.environment}-control-plane"
  engine                              = "aurora-postgresql"
  engine_mode                         = "provisioned"
  engine_version                      = var.aurora_engine_version
  database_name                       = "platform_db"
  master_username                     = "cluster_admin"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = var.secrets_kms_key_arn
  db_cluster_parameter_group_name     = aws_rds_cluster_parameter_group.postgres.name
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.postgres.id]
  storage_encrypted                   = true
  kms_key_id                          = var.environment_kms_key_arn
  iam_database_authentication_enabled = true
  enable_http_endpoint                = true
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  backup_retention_period             = var.backup_retention_days
  preferred_backup_window             = "18:00-19:00"
  preferred_maintenance_window        = "sun:19:00-sun:20:00"
  copy_tags_to_snapshot               = true
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "alter-${var.environment}-control-plane-final"

  serverlessv2_scaling_configuration {
    min_capacity = var.aurora_min_capacity
    max_capacity = var.aurora_max_capacity
  }

  tags = {
    Name             = "alter-${var.environment}-control-plane"
    Environment      = var.environment
    DatabaseContract = join(",", sort(keys(local.database_catalog)))
  }
}

resource "aws_rds_cluster_instance" "control_plane" {
  for_each = toset(["writer", "reader"])

  identifier                      = "alter-${var.environment}-control-${each.key}"
  cluster_identifier              = aws_rds_cluster.control_plane.id
  instance_class                  = "db.serverless"
  engine                          = aws_rds_cluster.control_plane.engine
  engine_version                  = aws_rds_cluster.control_plane.engine_version
  db_subnet_group_name            = aws_db_subnet_group.this.name
  availability_zone               = local.availability_zones[each.key == "writer" ? 0 : 1]
  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = var.environment_kms_key_arn
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn
  promotion_tier                  = each.key == "writer" ? 0 : 1

  tags = {
    Environment = var.environment
    Role        = each.key
    Cluster     = "control-plane"
  }
}

resource "aws_rds_cluster" "ads" {
  cluster_identifier                  = "alter-${var.environment}-ads"
  engine                              = "aurora-postgresql"
  engine_mode                         = "provisioned"
  engine_version                      = var.aurora_engine_version
  master_username                     = "ads_admin"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = var.secrets_kms_key_arn
  db_cluster_parameter_group_name     = aws_rds_cluster_parameter_group.postgres.name
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.postgres.id]
  storage_encrypted                   = true
  kms_key_id                          = var.environment_kms_key_arn
  iam_database_authentication_enabled = true
  enable_http_endpoint                = true
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  backup_retention_period             = var.backup_retention_days
  preferred_backup_window             = "20:00-21:00"
  preferred_maintenance_window        = "sun:21:00-sun:22:00"
  copy_tags_to_snapshot               = true
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "alter-${var.environment}-ads-final"

  serverlessv2_scaling_configuration {
    min_capacity = var.aurora_min_capacity
    max_capacity = var.aurora_max_capacity
  }

  tags = {
    Name        = "alter-${var.environment}-ads"
    Environment = var.environment
    Scope       = "ads-shell-only"
  }
}

resource "aws_rds_cluster_instance" "ads" {
  for_each = toset(["writer", "reader"])

  identifier                      = "alter-${var.environment}-ads-${each.key}"
  cluster_identifier              = aws_rds_cluster.ads.id
  instance_class                  = "db.serverless"
  engine                          = aws_rds_cluster.ads.engine
  engine_version                  = aws_rds_cluster.ads.engine_version
  db_subnet_group_name            = aws_db_subnet_group.this.name
  availability_zone               = local.availability_zones[each.key == "writer" ? 0 : 1]
  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = var.environment_kms_key_arn
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn
  promotion_tier                  = each.key == "writer" ? 0 : 1

  tags = {
    Environment = var.environment
    Role        = each.key
    Cluster     = "ads"
  }
}

resource "aws_secretsmanager_secret" "database_credentials" {
  for_each = local.database_catalog

  #checkov:skip=CKV2_AWS_57:IAM database authentication issues ephemeral tokens; these path-enforcement containers hold no static password version to rotate.

  name                    = local.database_secret_paths[each.key]
  description             = "Credential container for ${each.key}, owned only by ${each.value}."
  kms_key_id              = var.secrets_kms_key_arn
  recovery_window_in_days = 30

  tags = {
    Environment        = var.environment
    Database           = each.key
    OwningService      = each.value
    CredentialBoundary = "one-service-one-database"
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name = "alter-${var.environment}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "monitoring.rds.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:${var.aws_partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_backup_vault" "data" {
  name        = "alter-${var.environment}-data"
  kms_key_arn = var.environment_kms_key_arn

  tags = {
    Environment = var.environment
    Scope       = "aurora"
  }
}

resource "aws_backup_plan" "data" {
  name = "alter-${var.environment}-data"

  rule {
    rule_name         = "daily-aurora"
    target_vault_name = aws_backup_vault.data.name
    schedule          = "cron(0 21 * * ? *)"

    lifecycle {
      delete_after = max(35, var.backup_retention_days)
    }
  }

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role" "backup" {
  name = "alter-${var.environment}-backup"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "backup.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:${var.aws_partition}:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_selection" "data" {
  name         = "alter-${var.environment}-aurora"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.data.id
  resources = [
    aws_rds_cluster.control_plane.arn,
    aws_rds_cluster.ads.arn,
  ]
}

resource "aws_iam_policy" "database_access" {
  for_each = local.database_catalog

  name        = "alter-${var.environment}-${replace(each.key, "_", "-")}-access"
  description = "Access only ${each.key} credentials and its unique IAM database user."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadSingleDatabaseCredential"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"]
        Resource = [local.database_secret_arn_patterns[each.key]]
      },
      {
        Sid      = "DecryptSingleDatabaseCredential"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = var.secrets_kms_key_arn
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = var.account_id
            "kms:ViaService"    = "secretsmanager.${var.aws_region}.amazonaws.com"
          }
        }
      },
      {
        Sid      = "ConnectAsSingleDatabaseUser"
        Effect   = "Allow"
        Action   = "rds-db:connect"
        Resource = "arn:${var.aws_partition}:rds-db:${var.aws_region}:${var.account_id}:dbuser:${aws_rds_cluster.control_plane.cluster_resource_id}/${local.database_user_names[each.key]}"
      },
    ]
  })

  tags = {
    Environment   = var.environment
    Database      = each.key
    OwningService = each.value
  }
}

resource "terraform_data" "logical_database" {
  for_each = local.database_catalog

  triggers_replace = [
    aws_rds_cluster.control_plane.arn,
    each.key,
    local.database_user_names[each.key],
    filesha256("${path.module}/scripts/bootstrap-logical-database.sh"),
  ]

  provisioner "local-exec" {
    command = "${path.module}/scripts/bootstrap-logical-database.sh"
    environment = {
      AWS_REGION       = var.aws_region
      CLUSTER_ARN      = aws_rds_cluster.control_plane.arn
      ADMIN_SECRET_ARN = aws_rds_cluster.control_plane.master_user_secret[0].secret_arn
      DATABASE_NAME    = each.key
      DATABASE_USER    = local.database_user_names[each.key]
    }
  }

  depends_on = [aws_rds_cluster_instance.control_plane]
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "alter-${var.environment}-redis"
  subnet_ids = sort(values(var.private_subnet_ids))
}

resource "aws_security_group" "redis" {
  name_prefix = "alter-${var.environment}-redis-"
  description = "ElastiCache for Redis access from the environment VPC only."
  vpc_id      = var.vpc_id

  tags = {
    Name        = "alter-${var.environment}-redis"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "redis" {
  security_group_id = aws_security_group.redis.id
  description       = "Redis TLS from private environment workloads"
  cidr_ipv4         = var.vpc_cidr
  from_port         = 6379
  ip_protocol       = "tcp"
  to_port           = 6379
}

resource "aws_elasticache_user" "disabled_default" {
  user_id       = "alter-${var.environment}-default"
  user_name     = "default"
  access_string = "off -@all"
  engine        = "redis"

  authentication_mode {
    type = "no-password-required"
  }
}

resource "aws_elasticache_user" "runtime" {
  user_id       = "alter-${var.environment}-runtime"
  user_name     = "alter_${var.environment}_runtime"
  access_string = "on ~* +@all"
  engine        = "redis"

  authentication_mode {
    type = "iam"
  }
}

resource "aws_elasticache_user_group" "runtime" {
  engine        = "redis"
  user_group_id = "alter-${var.environment}-runtime"
  user_ids = [
    aws_elasticache_user.disabled_default.user_id,
    aws_elasticache_user.runtime.user_id,
  ]
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "alter-${var.environment}-redis"
  description                = "Alter ${var.environment} Redis"
  engine                     = "redis"
  engine_version             = var.redis_engine_version
  node_type                  = var.redis_node_type
  port                       = 6379
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  kms_key_id                 = var.environment_kms_key_arn
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  user_group_ids             = [aws_elasticache_user_group.runtime.id]
  snapshot_retention_limit   = var.redis_snapshot_retention_days
  snapshot_window            = "17:00-18:00"
  maintenance_window         = "sun:16:00-sun:17:00"
  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = {
    Name        = "alter-${var.environment}-redis"
    Environment = var.environment
    Tier        = "private"
  }
}
