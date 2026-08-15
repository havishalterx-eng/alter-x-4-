#!/bin/sh
# INGR-7: canonical-events bus/rule/queue mirror of the real Terraform
# (infrastructure/terraform/modules/messaging/main.tf) for the "local"
# environment. Every bound below intentionally matches the module:
#   bus            alter-<env>
#   rule           alter-<env>-canonical-events, source prefix "alter."
#   target         FIFO alter-<env>-events.fifo, message_group_id "alter-events"
#   queue          visibility 120s, retention 345600s, receive_wait 20s,
#                  content-based dedup, redrive -> DLQ at 5 receives
#   dlq            retention 1209600s, content-based dedup
set -eu

ALTER_ENV="${ALTER_ENV:-local}"
REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
ACCOUNT_ID="000000000000"

BUS_NAME="alter-${ALTER_ENV}"
RULE_NAME="alter-${ALTER_ENV}-canonical-events"
QUEUE_NAME="alter-${ALTER_ENV}-events.fifo"
DLQ_NAME="alter-${ALTER_ENV}-events-dlq.fifo"
QUEUE_ARN="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${QUEUE_NAME}"
DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${DLQ_NAME}"
RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${BUS_NAME}/${RULE_NAME}"

if ! awslocal events describe-event-bus \
  --name "$BUS_NAME" >/dev/null 2>&1; then
  awslocal events create-event-bus --name "$BUS_NAME"
fi

if ! awslocal sqs get-queue-url --queue-name "$DLQ_NAME" >/dev/null 2>&1; then
  awslocal sqs create-queue \
    --queue-name "$DLQ_NAME" \
    --attributes '{
      "FifoQueue": "true",
      "ContentBasedDeduplication": "true",
      "MessageRetentionPeriod": "1209600"
    }'
fi
DLQ_URL="$(awslocal sqs get-queue-url --queue-name "$DLQ_NAME" --output text)"

if ! awslocal sqs get-queue-url --queue-name "$QUEUE_NAME" >/dev/null 2>&1; then
  awslocal sqs create-queue \
    --queue-name "$QUEUE_NAME" \
    --attributes "{
      \"FifoQueue\": \"true\",
      \"ContentBasedDeduplication\": \"true\",
      \"VisibilityTimeout\": \"120\",
      \"MessageRetentionPeriod\": \"345600\",
      \"ReceiveMessageWaitTimeSeconds\": \"20\",
      \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\": \\\"${DLQ_ARN}\\\", \\\"maxReceiveCount\\\": 5}\"
    }"
fi
QUEUE_URL="$(awslocal sqs get-queue-url --queue-name "$QUEUE_NAME" --output text)"

if ! awslocal events describe-rule \
  --name "$RULE_NAME" --event-bus-name "$BUS_NAME" >/dev/null 2>&1; then
  awslocal events put-rule \
    --event-bus-name "$BUS_NAME" \
    --name "$RULE_NAME" \
    --event-pattern '{"source":[{"prefix":"alter."}]}'
fi

if ! awslocal events list-targets-by-rule \
  --rule "$RULE_NAME" --event-bus-name "$BUS_NAME" \
  | grep -q "$QUEUE_ARN"; then
  awslocal events put-targets \
    --event-bus-name "$BUS_NAME" \
    --rule "$RULE_NAME" \
    --targets "[{
      \"Id\": \"canonical-dispatch-queue\",
      \"Arn\": \"${QUEUE_ARN}\",
      \"SqsParameters\": {\"MessageGroupId\": \"alter-events\"}
    }]"
fi

# Guard: the SQS consumer must not be able to receive from this queue
# unless the FIFO message group was actually set by EventBridge. Keep the
# real Terraform queue policy so the local shape matches prod.
awslocal sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes "{
    \"Policy\": \"{\\\"Version\\\": \\\"2012-10-17\\\", \\\"Statement\\\": [{\\\"Sid\\\": \\\"AllowEventBridgeCanonicalRule\\\", \\\"Effect\\\": \\\"Allow\\\", \\\"Principal\\\": {\\\"Service\\\": \\\"events.amazonaws.com\\\"}, \\\"Action\\\": \\\"sqs:SendMessage\\\", \\\"Resource\\\": \\\"${QUEUE_ARN}\\\", \\\"Condition\\\": {\\\"ArnEquals\\\": {\\\"aws:SourceArn\\\": \\\"${RULE_ARN}\\\"}}}]}\"
  }"

# The DLQ may only be driven by the canonical queue (matches
# aws_sqs_queue_redrive_allow_policy).
awslocal sqs set-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attributes "{
    \"RedriveAllowPolicy\": \"{\\\"redrivePermission\\\": \\\"byQueue\\\", \\\"sourceQueueArns\\\": [\\\"${QUEUE_ARN}\\\"]}\"
  }"