# Fargate service module — the piece missing from the current IaC.
#
# Security properties this module makes non-optional, because they are the ones
# that decide whether findings 1/6/8 are internet-reachable:
#
#   * tasks run in PRIVATE subnets with assign_public_ip = false;
#   * the task attaches the caller-supplied per-service security group from
#     modules/compute, so its listener is reachable only from named peers;
#   * no load balancer is attached and none can be, by construction — a public
#     surface has to be an explicit, reviewable addition elsewhere;
#   * secrets arrive as `secrets` (valueFrom ARNs), never as plaintext
#     `environment` values, matching README working rule 6;
#   * root filesystem is read-only and the container runs as a non-root user;
#   * execute-command (ECS exec) is opt-in and defaults off.

locals {
  container_name = var.name

  # Plain config only. A value that belongs in Secrets Manager or Parameter
  # Store must be passed via var.secrets so it never lands in the task
  # definition JSON, which is readable by anyone with ecs:DescribeTaskDefinition.
  environment = [
    for key in sort(keys(var.environment)) : {
      name  = key
      value = var.environment[key]
    }
  ]

  secrets = [
    for key in sort(keys(var.secrets)) : {
      name      = key
      valueFrom = var.secrets[key]
    }
  ]

  port_mappings = var.container_port == null ? [] : [
    {
      containerPort = var.container_port
      protocol      = "tcp"
    }
  ]
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/alter/${var.environment_name}/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.environment_kms_key_arn

  tags = {
    Environment = var.environment_name
    Service     = var.name
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = "alter-${var.environment_name}-${var.name}"
  cpu                      = var.cpu
  memory                   = var.memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = var.image
      essential = true

      # Defence in depth inside the task itself.
      readonlyRootFilesystem = true
      user                   = var.container_user
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }

      portMappings = local.port_mappings
      environment  = local.environment
      secrets      = local.secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = var.name
        }
      }

      healthCheck = var.health_check_command == null ? null : {
        command     = var.health_check_command
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = {
    Environment = var.environment_name
    Service     = var.name
  }
}

resource "aws_ecs_service" "this" {
  name            = var.name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"
  propagate_tags  = "SERVICE"

  # ECS exec opens an interactive shell into a running task. Off unless a
  # human deliberately enables it for a non-prod environment.
  enable_execute_command = var.enable_execute_command

  network_configuration {
    subnets = var.private_subnet_ids
    # The single most important line in this file: no task gets a public IP,
    # so no internal listener is addressable from the internet.
    assign_public_ip = false
    security_groups  = [var.security_group_id]
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  tags = {
    Environment = var.environment_name
    Service     = var.name
  }
}
