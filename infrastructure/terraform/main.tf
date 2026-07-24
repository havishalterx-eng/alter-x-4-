locals {
  expected_purposes = {
    alter-management      = "Organizations, billing, Control Tower. NO application workloads."
    alter-log-archive     = "Central CloudTrail, AWS Config, immutable security logs"
    alter-security        = "Security tooling, GuardDuty/Security Hub admin, audit access, break-glass"
    alter-shared-services = "CI/CD support, shared DNS, container registry (ECR), common networking"
    alter-dev             = "dev workloads"
    alter-staging         = "staging workloads"
    alter-prod            = "prod workloads"
    alter-sandbox-exec    = "High-risk browser + code-execution workloads, external sandbox-provider integration. Separate blast radius from control plane."
  }

  all_scp_targets = setunion(
    var.scp_target_ids.baseline,
    var.scp_target_ids.production,
    var.scp_target_ids.sandbox,
  )

  global_service_actions = [
    "account:*",
    "aws-portal:*",
    "budgets:*",
    "ce:*",
    "cloudfront:*",
    "globalaccelerator:*",
    "iam:*",
    "organizations:*",
    "route53:*",
    "route53domains:*",
    "support:*",
  ]

  vpc_range_starts = {
    for name, cidr in var.environment_vpc_cidrs :
    name => sum([
      for index, octet in split(".", cidrhost(cidr, 0)) :
      tonumber(octet) * pow(256, 3 - index)
    ])
  }

  vpc_ranges = {
    for name, cidr in var.environment_vpc_cidrs :
    name => {
      start = local.vpc_range_starts[name]
      end   = local.vpc_range_starts[name] + pow(2, 32 - tonumber(split("/", cidr)[1])) - 1
    }
  }
}

check "account_purposes_match_catalog" {
  assert {
    condition = alltrue([
      for name, purpose in local.expected_purposes : var.accounts[name].purpose == purpose
    ])
    error_message = "Each account purpose must exactly match the approved eight-account catalog."
  }
}

check "existing_accounts_are_imported" {
  assert {
    condition = var.mock_provider || (
      var.enable_existing_account_imports &&
      length(setsubtract(
        toset(keys(var.existing_account_ids)),
        toset(["alter-management", "alter-log-archive", "alter-security"]),
        )) == 0 && length(setsubtract(
        toset(["alter-management", "alter-log-archive", "alter-security"]),
        toset(keys(var.existing_account_ids)),
      )) == 0
    )
    error_message = "Real plans must import management, log-archive, and security accounts before creating member accounts."
  }
}

check "environment_vpc_cidrs_do_not_overlap" {
  assert {
    condition = alltrue(flatten([
      for name, range in local.vpc_ranges : [
        for other_name, other_range in local.vpc_ranges :
        name == other_name || (
          range.end < other_range.start ||
          other_range.end < range.start
        )
      ]
    ]))
    error_message = "Environment VPC CIDRs must not overlap."
  }
}

module "account" {
  for_each = var.accounts
  source   = "./modules/account"

  name      = each.key
  email     = each.value.email
  parent_id = each.value.parent_id
  purpose   = each.value.purpose
  role_name = each.key == "alter-management" ? null : var.account_role_name
}

import {
  for_each = var.enable_existing_account_imports ? var.existing_account_ids : {}
  to       = module.account[each.key].aws_organizations_account.this
  id       = each.value
}

module "region_guardrail" {
  source = "./modules/scp"

  name        = "alter-deny-unapproved-regions"
  description = "Deny regional service use outside the approved Alter home region."
  target_ids  = local.all_scp_targets
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyOutsideApprovedRegion"
      Effect    = "Deny"
      NotAction = local.global_service_actions
      Resource  = "*"
      Condition = {
        StringNotEquals = {
          "aws:RequestedRegion" = var.aws_region
        }
      }
    }]
  })
}

module "audit_guardrail" {
  source = "./modules/scp"

  name        = "alter-protect-audit-services"
  description = "Prevent member accounts from disabling CloudTrail or AWS Config."
  target_ids  = local.all_scp_targets
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "ProtectCloudTrailAndConfig"
      Effect = "Deny"
      Action = [
        "cloudtrail:DeleteTrail",
        "cloudtrail:StopLogging",
        "cloudtrail:UpdateTrail",
        "config:DeleteConfigurationRecorder",
        "config:DeleteDeliveryChannel",
        "config:StopConfigurationRecorder",
      ]
      Resource = "*"
    }]
  })
}

module "root_user_guardrail" {
  source = "./modules/scp"

  name        = "alter-deny-root-user-actions"
  description = "Deny member-account root-user actions; emergency access uses audited break-glass roles instead."
  target_ids  = local.all_scp_targets
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "DenyRootUser"
      Effect   = "Deny"
      Action   = "*"
      Resource = "*"
      Condition = {
        ArnLike = {
          "aws:PrincipalArn" = var.root_principal_arn_pattern
        }
      }
    }]
  })
}

module "production_guardrail" {
  source = "./modules/scp"

  name        = "alter-production-credential-and-kms-guardrails"
  description = "Prevent long-lived production credentials and KMS key lockout outside break-glass."
  target_ids  = var.scp_target_ids.production
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyLongLivedHumanCredentials"
        Effect = "Deny"
        Action = [
          "iam:CreateAccessKey",
          "iam:CreateLoginProfile",
          "iam:UpdateLoginProfile",
        ]
        Resource = "*"
      },
      {
        Sid    = "ProtectProductionKmsKeys"
        Effect = "Deny"
        Action = [
          "kms:DisableKey",
          "kms:ScheduleKeyDeletion",
        ]
        Resource = "*"
        Condition = {
          ArnNotLike = {
            "aws:PrincipalArn" = sort(tolist(var.break_glass_role_arns))
          }
        }
      },
    ]
  })
}

module "sandbox_guardrail" {
  source = "./modules/scp"

  name        = "alter-sandbox-network-isolation"
  description = "Prevent the high-risk sandbox account from establishing cross-account network paths."
  target_ids  = var.scp_target_ids.sandbox
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "DenyCrossAccountNetworkPaths"
      Effect = "Deny"
      Action = [
        "ec2:AcceptVpcPeeringConnection",
        "ec2:CreateTransitGatewayPeeringAttachment",
        "ec2:CreateVpcPeeringConnection",
        "ram:AcceptResourceShareInvitation",
        "ram:CreateResourceShare",
      ]
      Resource = "*"
    }]
  })
}
