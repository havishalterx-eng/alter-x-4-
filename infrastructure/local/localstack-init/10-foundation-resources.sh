#!/bin/sh
set -eu

: "${AUDIT_DB_PASSWORD:?AUDIT_DB_PASSWORD is required}"
: "${DATABASE_SECRET_REF:?DATABASE_SECRET_REF is required}"

AUDIT_DB_HOST="${AUDIT_DB_HOST:-127.0.0.1}"
AUDIT_DB_PORT="${AUDIT_DB_PORT:-5433}"
AUDIT_DATABASE_NAME="${AUDIT_DATABASE_NAME:-audit_db}"
AUDIT_DATABASE_USER="${AUDIT_DATABASE_USER:-audit_service}"
COST_QUEUE_NAME="alter-local-cost-events"
COST_DLQ_NAME="alter-local-cost-events-dlq"

umask 077
dsn_file="$(mktemp)"
dlq_attributes_file="$(mktemp)"
queue_attributes_file="$(mktemp)"
trap 'rm -f "$dsn_file" "$dlq_attributes_file" "$queue_attributes_file"' EXIT

export AUDIT_DB_HOST AUDIT_DB_PORT AUDIT_DATABASE_NAME AUDIT_DATABASE_USER
python3 - "$dsn_file" <<'PY'
import os
import pathlib
import sys
from urllib.parse import quote

user = quote(os.environ["AUDIT_DATABASE_USER"], safe="")
password = quote(os.environ["AUDIT_DB_PASSWORD"], safe="")
host = os.environ["AUDIT_DB_HOST"]
port = os.environ["AUDIT_DB_PORT"]
database = quote(os.environ["AUDIT_DATABASE_NAME"], safe="")
pathlib.Path(sys.argv[1]).write_text(
    f"postgresql://{user}:{password}@{host}:{port}/{database}",
    encoding="utf-8",
)
PY

if awslocal secretsmanager describe-secret \
  --secret-id "$DATABASE_SECRET_REF" >/dev/null 2>&1; then
  awslocal secretsmanager put-secret-value \
    --secret-id "$DATABASE_SECRET_REF" \
    --secret-string "file://$dsn_file" >/dev/null
else
  awslocal secretsmanager create-secret \
    --name "$DATABASE_SECRET_REF" \
    --secret-string "file://$dsn_file" >/dev/null
fi

dlq_url="$(awslocal sqs create-queue \
  --queue-name "$COST_DLQ_NAME" \
  --query QueueUrl \
  --output text)"
queue_url="$(awslocal sqs create-queue \
  --queue-name "$COST_QUEUE_NAME" \
  --query QueueUrl \
  --output text)"
dlq_arn="$(awslocal sqs get-queue-attributes \
  --queue-url "$dlq_url" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn \
  --output text)"

python3 - "$dlq_attributes_file" "$queue_attributes_file" "$dlq_arn" <<'PY'
import json
import pathlib
import sys

pathlib.Path(sys.argv[1]).write_text(
    json.dumps({
        "MessageRetentionPeriod": "1209600",
        "SqsManagedSseEnabled": "true",
    }),
    encoding="utf-8",
)
pathlib.Path(sys.argv[2]).write_text(
    json.dumps({
        "VisibilityTimeout": "120",
        "MessageRetentionPeriod": "345600",
        "ReceiveMessageWaitTimeSeconds": "20",
        "SqsManagedSseEnabled": "true",
        "RedrivePolicy": json.dumps({
            "deadLetterTargetArn": sys.argv[3],
            "maxReceiveCount": 5,
        }),
    }),
    encoding="utf-8",
)
PY

awslocal sqs set-queue-attributes \
  --queue-url "$dlq_url" \
  --attributes "file://$dlq_attributes_file"
awslocal sqs set-queue-attributes \
  --queue-url "$queue_url" \
  --attributes "file://$queue_attributes_file"

echo "Local foundation resources ready"
