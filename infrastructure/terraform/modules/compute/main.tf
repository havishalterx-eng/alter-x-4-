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
