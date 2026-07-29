locals {
  bucket_name             = "alter-${var.account_id}-${var.environment}-artifacts"
  access_logs_bucket_name = "alter-${var.account_id}-${var.environment}-artifact-access-logs"
}

resource "aws_s3_bucket" "artifacts" {
  #checkov:skip=CKV_AWS_144:Cross-region replication conflicts with the approved ap-south-1-only guardrail and environment/account isolation model.
  bucket = local.bucket_name

  tags = {
    Name        = local.bucket_name
    Environment = var.environment
    Purpose     = "alter-artifacts"
  }
}

resource "aws_s3_bucket_ownership_controls" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = var.environment_kms_key_arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.artifacts.arn,
        "${aws_s3_bucket.artifacts.arn}/*",
      ]
      Condition = {
        Bool = {
          "aws:SecureTransport" = "false"
        }
      }
    }]
  })
}

resource "aws_s3_bucket_logging" "artifacts" {
  bucket        = aws_s3_bucket.artifacts.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "artifacts/"

  depends_on = [aws_s3_bucket_policy.access_logs]
}

resource "aws_s3_bucket_notification" "artifacts" {
  bucket      = aws_s3_bucket.artifacts.id
  eventbridge = true
}

resource "aws_s3_bucket" "access_logs" {
  #checkov:skip=CKV_AWS_18:This dedicated log sink must not log to itself or create an infinite logging chain.
  #checkov:skip=CKV_AWS_145:AWS requires S3 access-log destination buckets to use SSE-S3; SSE-KMS can make delivered logs inaccessible.
  #checkov:skip=CKV_AWS_144:Cross-region replication conflicts with the approved ap-south-1-only guardrail.
  #checkov:skip=CKV2_AWS_62:This audit-log sink has no event-driven consumer; source artifact events are enabled separately.
  bucket = local.access_logs_bucket_name

  tags = {
    Name        = local.access_logs_bucket_name
    Environment = var.environment
    Purpose     = "artifact-access-logs"
  }
}

resource "aws_s3_bucket_ownership_controls" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = 365
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.access_logs]
}

resource "aws_s3_bucket_policy" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.access_logs.arn,
          "${aws_s3_bucket.access_logs.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid    = "AllowServerAccessLogs"
        Effect = "Allow"
        Principal = {
          Service = "logging.s3.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.access_logs.arn}/artifacts/*"
        Condition = {
          ArnLike = {
            "aws:SourceArn" = aws_s3_bucket.artifacts.arn
          }
          StringEquals = {
            "aws:SourceAccount" = var.account_id
          }
        }
      },
    ]
  })
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "build-logs-90-days"
    status = "Enabled"

    filter {
      tag {
        key   = "retention_class"
        value = "build-log"
      }
    }

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  rule {
    id     = "preview-artifacts-30-days"
    status = "Enabled"

    filter {
      tag {
        key   = "retention_class"
        value = "preview-artifact"
      }
    }

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "failed-run-diagnostics-90-days"
    status = "Enabled"

    filter {
      tag {
        key   = "retention_class"
        value = "failed-run-diagnostic"
      }
    }

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.artifacts]
}

resource "aws_cloudwatch_event_bus" "alter" {
  name = "alter-${var.environment}"

  tags = {
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "canonical_dlq" {
  name                        = "alter-${var.environment}-events-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  message_retention_seconds   = 1209600
  sqs_managed_sse_enabled     = true

  tags = {
    Environment = var.environment
    QueueRole   = "canonical-dlq"
  }
}

resource "aws_sqs_queue" "canonical" {
  name                        = "alter-${var.environment}-events.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  visibility_timeout_seconds  = 120
  message_retention_seconds   = 345600
  receive_wait_time_seconds   = 20
  sqs_managed_sse_enabled     = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.canonical_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Environment = var.environment
    QueueRole   = "canonical-dispatch"
  }
}

resource "aws_sqs_queue_redrive_allow_policy" "canonical_dlq" {
  queue_url = aws_sqs_queue.canonical_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.canonical.arn]
  })
}

resource "aws_sqs_queue" "cost_events_dlq" {
  name                      = "alter-${var.environment}-cost-events-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true

  tags = {
    Environment = var.environment
    QueueRole   = "cost-events-dlq"
  }
}

resource "aws_sqs_queue" "cost_events" {
  name                       = "alter-${var.environment}-cost-events"
  visibility_timeout_seconds = 120
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.cost_events_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Environment   = var.environment
    QueueRole     = "cost-events"
    ReconcileWith = "FOUND-7"
  }
}

resource "aws_sqs_queue_redrive_allow_policy" "cost_events_dlq" {
  queue_url = aws_sqs_queue.cost_events_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.cost_events.arn]
  })
}

resource "aws_cloudwatch_event_rule" "canonical" {
  name           = "alter-${var.environment}-canonical-events"
  description    = "Dispatch all canonical Alter events in order."
  event_bus_name = aws_cloudwatch_event_bus.alter.name
  event_pattern = jsonencode({
    source = [{ prefix = "alter." }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_cloudwatch_event_target" "canonical" {
  rule           = aws_cloudwatch_event_rule.canonical.name
  event_bus_name = aws_cloudwatch_event_bus.alter.name
  target_id      = "canonical-dispatch-queue"
  arn            = aws_sqs_queue.canonical.arn

  sqs_target {
    message_group_id = "alter-events"
  }
}

resource "aws_cloudwatch_event_rule" "cost_events" {
  name           = "alter-${var.environment}-cost-events"
  description    = "Route cost events to the queue reserved for FOUND-7 reconciliation."
  event_bus_name = aws_cloudwatch_event_bus.alter.name
  event_pattern = jsonencode({
    source = ["alter.cost-ledger"]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_cloudwatch_event_target" "cost_events" {
  rule           = aws_cloudwatch_event_rule.cost_events.name
  event_bus_name = aws_cloudwatch_event_bus.alter.name
  target_id      = "cost-event-queue"
  arn            = aws_sqs_queue.cost_events.arn
}

resource "aws_sqs_queue_policy" "canonical" {
  queue_url = aws_sqs_queue.canonical.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowEventBridgeCanonicalRule"
      Effect = "Allow"
      Principal = {
        Service = "events.amazonaws.com"
      }
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.canonical.arn
      Condition = {
        ArnEquals = {
          "aws:SourceArn" = aws_cloudwatch_event_rule.canonical.arn
        }
      }
    }]
  })
}

resource "aws_sqs_queue_policy" "cost_events" {
  queue_url = aws_sqs_queue.cost_events.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowEventBridgeCostRule"
      Effect = "Allow"
      Principal = {
        Service = "events.amazonaws.com"
      }
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.cost_events.arn
      Condition = {
        ArnEquals = {
          "aws:SourceArn" = aws_cloudwatch_event_rule.cost_events.arn
        }
      }
    }]
  })
}

# KNOW-6: staging bucket for signed-URL uploads (ADS ingestion). Transient
# by design -- the app deletes an object immediately after it's consumed
# into the real ingestion pipeline (see apps/ads-core's
# `complete_upload` handler); the lifecycle rule below is the backstop for
# uploads that were presigned but never completed, not the primary
# cleanup path.
locals {
  ads_uploads_bucket_name = "alter-${var.account_id}-${var.environment}-ads-uploads"
}

resource "aws_s3_bucket" "ads_uploads" {
  #checkov:skip=CKV_AWS_144:Cross-region replication conflicts with the approved ap-south-1-only guardrail and environment/account isolation model.
  bucket = local.ads_uploads_bucket_name

  tags = {
    Name        = local.ads_uploads_bucket_name
    Environment = var.environment
    Purpose     = "ads-upload-staging"
    Scope       = "transient-pre-ingestion"
  }
}

resource "aws_s3_bucket_ownership_controls" "ads_uploads" {
  bucket = aws_s3_bucket.ads_uploads.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "ads_uploads" {
  bucket = aws_s3_bucket.ads_uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ads_uploads" {
  bucket = aws_s3_bucket.ads_uploads.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = var.environment_kms_key_arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "ads_uploads" {
  bucket = aws_s3_bucket.ads_uploads.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.ads_uploads.arn,
        "${aws_s3_bucket.ads_uploads.arn}/*",
      ]
      Condition = {
        Bool = {
          "aws:SecureTransport" = "false"
        }
      }
    }]
  })
}

resource "aws_s3_bucket_logging" "ads_uploads" {
  bucket        = aws_s3_bucket.ads_uploads.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "ads-uploads/"

  depends_on = [aws_s3_bucket_policy.access_logs]
}

# Real S3 event delivery is enabled here (same mechanism the `artifacts`
# bucket already uses); no EventBridge rule or SQS consumer subscribes to
# it yet -- real completion today is app-triggered after a server-side
# `head_object` existence/size/type check (see apps/ads-core), not this
# event. A follow-up ticket adds the real EventBridge rule + SQS consumer
# so completion becomes provider-verified instead of client-triggered.
resource "aws_s3_bucket_notification" "ads_uploads" {
  bucket      = aws_s3_bucket.ads_uploads.id
  eventbridge = true
}

resource "aws_s3_bucket_lifecycle_configuration" "ads_uploads" {
  bucket = aws_s3_bucket.ads_uploads.id

  rule {
    id     = "expire-abandoned-uploads"
    status = "Enabled"

    filter {
      prefix = "tenants/"
    }

    expiration {
      days = 1
    }
  }
}
