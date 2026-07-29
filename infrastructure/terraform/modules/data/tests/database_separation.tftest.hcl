mock_provider "aws" {}

run "database_separation_contract" {
  command = plan

  variables {
    environment                       = "dev"
    account_id                        = "000000000000"
    aws_partition                     = "aws"
    aws_region                        = "ap-south-1"
    vpc_id                            = "vpc-00000000000000000"
    vpc_cidr                          = "10.20.0.0/16"
    allowed_source_security_group_ids = { ads_client = "sg-00000000000000000" }
    private_subnet_ids                = { "ap-south-1a" = "subnet-00000000000000001", "ap-south-1b" = "subnet-00000000000000002" }
    environment_kms_key_arn           = "arn:aws:kms:ap-south-1:000000000000:key/00000000-0000-0000-0000-000000000000"
    secrets_kms_key_arn               = "arn:aws:kms:ap-south-1:000000000000:key/11111111-1111-1111-1111-111111111111"
    aurora_engine_version             = "16.6"
    aurora_parameter_group_family     = "aurora-postgresql16"
    aurora_min_capacity               = 0.5
    aurora_max_capacity               = 4
    backup_retention_days             = 7
    deletion_protection               = false
    redis_engine_version              = "7.1"
    redis_node_type                   = "cache.t4g.small"
    redis_snapshot_retention_days     = 7
  }

  assert {
    condition = toset(keys(output.database_contract)) == toset([
      "platform_db",
      "orchestration_db",
      "intelligence_db",
      "policy_db",
      "cost_db",
      "eval_db",
      "audit_db",
    ])
    error_message = "The control-plane cluster must declare exactly the seven approved logical databases."
  }

  assert {
    condition     = length(distinct([for contract in values(output.database_contract) : contract.owner])) == 7
    error_message = "Every logical database must have one distinct owning service."
  }

  assert {
    condition     = length(distinct([for contract in values(output.database_contract) : contract.secret_path])) == 7
    error_message = "Every logical database must have a distinct Secrets Manager path."
  }

  assert {
    condition = alltrue([
      for grant in values(output.database_access_contract) :
      length(grant.secret_resources) == 1 && length(grant.database_users) == 1
    ])
    error_message = "No database access policy may grant more than one credential secret or database user."
  }

  assert {
    condition     = length(distinct(flatten([for grant in values(output.database_access_contract) : grant.secret_resources]))) == 7
    error_message = "Credential resource grants must not be shared across databases."
  }

  assert {
    condition     = aws_rds_cluster.ads.database_name == "ads"
    error_message = "ADS must use its dedicated ads database."
  }

  assert {
    condition     = aws_secretsmanager_secret.ads_database_credentials.name == "/alter/dev/ads-core/system/database_credentials"
    error_message = "ADS Core must have its own credential-container secret path."
  }

  assert {
    condition     = aws_security_group.ads_postgres.tags.Scope == "ads-core" && aws_vpc_security_group_ingress_rule.ads_postgres["ads_client"].from_port == 5432
    error_message = "ADS PostgreSQL must use its dedicated security group with workload-SG ingress."
  }
}
