resource "aws_cloudwatch_log_group" "ecs_exec" {
  name              = "/alter/${var.environment}/ecs-exec"
  retention_in_days = 365
  kms_key_id        = var.environment_kms_key_arn

  tags = {
    Environment = var.environment
  }
}

resource "aws_ecs_cluster" "this" {
  name = "alter-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }

  configuration {
    execute_command_configuration {
      kms_key_id = var.environment_kms_key_arn
      logging    = "OVERRIDE"

      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.ecs_exec.name
      }
    }
  }

  tags = {
    Name        = "alter-${var.environment}"
    Environment = var.environment
    LaunchType  = "FARGATE"
    BlastRadius = var.environment == "sandbox-exec" ? "isolated-sandbox" : "control-plane"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    base              = 1
    weight            = 1
  }
}

resource "aws_security_group" "ads_client" {
  name_prefix = "alter-${var.environment}-ads-client-"
  description = "Outbound-only identity for workloads permitted to reach ADS Aurora."
  vpc_id      = var.vpc_id

  tags = {
    Name        = "alter-${var.environment}-ads-client"
    Environment = var.environment
    Scope       = "ads-client"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Per-service workload identities.
#
# Every service gets its own security group so that reachability can be
# expressed peer-to-peer instead of by CIDR. Nothing here opens a port to the
# VPC: an internal listener is reachable only from the security groups named
# in var.mesh_calls, which is the whole point.
# ---------------------------------------------------------------------------
resource "aws_security_group" "service" {
  for_each = var.services

  name_prefix = "alter-${var.environment}-${each.key}-"
  description = "Workload identity for ${each.key}."
  vpc_id      = var.vpc_id

  tags = {
    Name        = "alter-${var.environment}-${each.key}"
    Environment = var.environment
    Service     = each.key
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Egress is declared explicitly: the aws_security_group resource manages egress
# as an empty set when no rule is declared, which would strip the AWS default
# allow-all and leave the task unable to reach NAT, AWS APIs or approved SaaS.
resource "aws_vpc_security_group_egress_rule" "service" {
  for_each = var.services

  security_group_id = aws_security_group.service[each.key].id
  description       = "Egress from ${each.key} via NAT to AWS APIs and approved SaaS."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

locals {
  # Flatten the call graph into one rule per (caller -> callee) pair.
  mesh_edges = merge([
    for callee, callers in var.mesh_calls : {
      for caller in callers :
      "${caller}-to-${callee}" => { callee = callee, caller = caller }
    }
  ]...)
}

resource "aws_vpc_security_group_ingress_rule" "mesh" {
  for_each = local.mesh_edges

  security_group_id            = aws_security_group.service[each.value.callee].id
  referenced_security_group_id = aws_security_group.service[each.value.caller].id
  description                  = "gRPC ${each.value.caller} -> ${each.value.callee}"
  from_port                    = var.services[each.value.callee].grpc_port
  to_port                      = var.services[each.value.callee].grpc_port
  ip_protocol                  = "tcp"
}
