locals {
  backend_services = toset([
    "platform-api",
    "orchestration-service",
    "intelligence-service",
    "model-gateway",
    "tool-gateway",
    "sandbox-service",
    "verification-service",
    "memory-service",
    "eval-service",
    "background-workers",
  ])
}

check "backend_service_catalog" {
  assert {
    condition     = length(local.backend_services) == 10 && !contains(local.backend_services, "platform-web")
    error_message = "ECR must contain exactly the ten approved backend services and exclude platform-web."
  }
}

resource "aws_ecr_repository" "service" {
  for_each = local.backend_services

  name                 = "alter-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name    = "alter-${each.key}"
    Service = each.key
    Scope   = "backend-container"
  }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each = aws_ecr_repository.service

  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 14 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Retain the newest 100 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "sha-"]
          countType     = "imageCountMoreThan"
          countNumber   = 100
        }
        action = { type = "expire" }
      },
    ]
  })
}
