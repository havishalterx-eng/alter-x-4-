output "artifacts_bucket_name" {
  description = "Environment artifact bucket name."
  value       = aws_s3_bucket.artifacts.id
}

output "event_bus_arn" {
  description = "Canonical Alter event bus ARN."
  value       = aws_cloudwatch_event_bus.alter.arn
}

output "canonical_queue_arn" {
  description = "Ordered canonical event-dispatch queue ARN."
  value       = aws_sqs_queue.canonical.arn
}

output "cost_event_queue_arn" {
  description = "Cost-event queue ARN reserved for FOUND-7 reconciliation."
  value       = aws_sqs_queue.cost_events.arn
}
