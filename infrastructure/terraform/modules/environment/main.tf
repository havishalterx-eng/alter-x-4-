locals {
  account_root_arn = "arn:${var.aws_partition}:iam::${var.account_id}:root"
  logs_arn_pattern = "arn:${var.aws_partition}:logs:${var.aws_region}:${var.account_id}:log-group:/alter/*"
}

check "ci_configuration" {
  assert {
    condition = !var.create_ci_role || (
      var.ci_principal_arn != null &&
      var.ci_external_id != null &&
      length(setunion(var.deployment_actions, var.global_deployment_actions)) > 0 &&
      length(var.deployment_resource_arns) > 0
    )
    error_message = "CI-enabled accounts require a principal ARN, external ID, actions, and resource ARNs."
  }
}

resource "aws_kms_key" "environment" {
  description             = "Alter ${var.account_name} environment key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = false
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AccountAdministrators"
        Effect = "Allow"
        Principal = {
          AWS = local.account_root_arn
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "CloudWatchLogsEncryption"
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.aws_region}.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey",
          "kms:ReEncryptFrom",
          "kms:ReEncryptTo",
        ]
        Resource = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = local.logs_arn_pattern
          }
        }
      },
    ]
  })

  tags = {
    Name        = "alter-${var.account_name}"
    Environment = var.account_name
    purpose     = var.purpose
  }
}

resource "aws_kms_alias" "environment" {
  name          = "alias/alter/${var.account_name}"
  target_key_id = aws_kms_key.environment.key_id
}

resource "aws_budgets_budget" "account" {
  name         = "alter-${var.account_name}-monthly"
  account_id   = var.account_id
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = toset(var.budget_alert_thresholds)
    content {
      comparison_operator        = "GREATER_THAN"
      notification_type          = "FORECASTED"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      subscriber_email_addresses = [var.budget_alert_email]
    }
  }

  tags = {
    Environment = var.account_name
    purpose     = var.purpose
  }
}

resource "aws_iam_policy" "deployment_boundary" {
  count = var.create_ci_role ? 1 : 0

  name        = "alter-ci-deployment-boundary"
  description = "Maximum permissions available to the shared-services CI deployment role."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect   = "Allow"
        Action   = sort(var.deployment_actions)
        Resource = sort(var.deployment_resource_arns)
      }],
      length(var.global_deployment_actions) == 0 ? [] : [{
        Effect   = "Allow"
        Action   = sort(var.global_deployment_actions)
        Resource = "*"
      }],
    )
  })

  tags = {
    Environment = var.account_name
  }
}

resource "aws_iam_role" "ci_deployment" {
  count = var.create_ci_role ? 1 : 0

  name                 = "alter-ci-deployment"
  max_session_duration = 3600
  permissions_boundary = aws_iam_policy.deployment_boundary[0].arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        AWS = var.ci_principal_arn
      }
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "sts:ExternalId" = var.ci_external_id
        }
      }
    }]
  })

  tags = {
    Environment = var.account_name
    Source      = "alter-shared-services"
  }
}

resource "aws_iam_role_policy" "ci_deployment" {
  count = var.create_ci_role ? 1 : 0

  name = "environment-deployment"
  role = aws_iam_role.ci_deployment[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect   = "Allow"
        Action   = sort(var.deployment_actions)
        Resource = sort(var.deployment_resource_arns)
      }],
      length(var.global_deployment_actions) == 0 ? [] : [{
        Effect   = "Allow"
        Action   = sort(var.global_deployment_actions)
        Resource = "*"
      }],
    )
  })
}

module "network" {
  count  = var.network == null ? 0 : 1
  source = "../network"

  name                    = var.account_name
  vpc_cidr                = var.network.vpc_cidr
  availability_zones      = var.network.availability_zones
  public_subnet_cidrs     = var.network.public_subnet_cidrs
  private_subnet_cidrs    = var.network.private_subnet_cidrs
  nat_gateway_strategy    = var.network.nat_gateway_strategy
  flow_log_retention_days = var.network.flow_log_retention_days
  kms_key_arn             = aws_kms_key.environment.arn
}
