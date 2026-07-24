locals {
  account_root_arn     = "arn:${var.aws_partition}:iam::${var.account_id}:root"
  system_secret_arn    = "arn:${var.aws_partition}:secretsmanager:${var.aws_region}:${var.account_id}:secret:/alter/${var.environment}/*/system/*"
  tenant_secret_arn    = "arn:${var.aws_partition}:secretsmanager:${var.aws_region}:${var.account_id}:secret:/alter/${var.environment}/tenant/*/integration/*/*"
  secrets_service_name = "secretsmanager.${var.aws_region}.amazonaws.com"
}

resource "aws_kms_key" "secrets" {
  description             = "Alter ${var.environment} Secrets Manager key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = false
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AccountOnlyAdministrationAndUse"
      Effect = "Allow"
      Principal = {
        AWS = local.account_root_arn
      }
      Action   = "kms:*"
      Resource = "*"
    }]
  })

  tags = {
    Name        = "alter-${var.environment}-secrets"
    Environment = var.environment
    DataClass   = "secrets"
  }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/alter/${var.environment}/secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_iam_policy" "system_secrets" {
  name        = "alter-${var.environment}-system-secrets"
  description = "Read system secrets only under the approved environment path."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadSystemSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"]
        Resource = local.system_secret_arn
      },
      {
        Sid      = "DecryptSystemSecrets"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.secrets.arn
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = var.account_id
            "kms:ViaService"    = local.secrets_service_name
          }
        }
      },
    ]
  })

  tags = {
    Environment = var.environment
    SecretScope = "system"
  }
}

resource "aws_iam_policy" "tenant_integration_secrets" {
  name        = "alter-${var.environment}-tenant-integration-secrets"
  description = "Read tenant integration secrets only under the approved tenant path."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadTenantIntegrationSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"]
        Resource = local.tenant_secret_arn
      },
      {
        Sid      = "DecryptTenantIntegrationSecrets"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.secrets.arn
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = var.account_id
            "kms:ViaService"    = local.secrets_service_name
          }
        }
      },
    ]
  })

  tags = {
    Environment = var.environment
    SecretScope = "tenant-integration"
  }
}

resource "aws_appconfig_application" "this" {
  name        = "alter-${var.environment}"
  description = "Runtime policy and feature-flag application for Alter ${var.environment}."

  tags = {
    Environment = var.environment
  }
}

resource "aws_appconfig_environment" "this" {
  application_id = aws_appconfig_application.this.id
  name           = var.environment
  description    = "Alter ${var.environment} runtime configuration environment."

  tags = {
    Environment = var.environment
  }
}

resource "aws_appconfig_configuration_profile" "runtime" {
  application_id = aws_appconfig_application.this.id
  name           = "runtime-policy"
  description    = "Hosted profile reserved for model aliases and runtime feature flags."
  location_uri   = "hosted"

  tags = {
    Environment = var.environment
  }
}
