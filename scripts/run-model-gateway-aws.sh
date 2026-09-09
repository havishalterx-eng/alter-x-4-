#!/bin/sh
# Run model-gateway against real AWS (Bedrock, AppConfig, Secrets Manager,
# SSM) while the rest of the local stack keeps talking to LocalStack.
#
# Why this script exists rather than a line in .env.local:
#
#   .env.local sets AWS_ENDPOINT_URL=http://127.0.0.1:4566 and the LocalStack
#   test credentials. AWS_ENDPOINT_URL is global to the SDK -- with it set,
#   every AWS call from this process goes to LocalStack, including Bedrock.
#   So a process that needs real AWS has to have it unset, and the rest of the
#   stack has to keep it. Both are true at once, which a single shared file
#   cannot express.
#
# Everything else still comes from .env.local, so this does not fork the
# configuration; it overrides exactly the four things that route AWS traffic,
# plus the config source.
#
# Usage:
#   sh scripts/run-model-gateway-aws.sh
#
# Requires:
#   - npx nx build model-gateway   (dist/apps/model-gateway/main.js)
#   - a named profile in ~/.aws/credentials, "alter" by default
#   - APPCONFIG_* identifiers and PLATFORM_ADMIN_SERVICE_TOKEN_SECRET_REF in
#     .env.local (see .env.local.example)
set -eu

# Git Bash on Windows rewrites values that look like Unix paths into Windows
# paths when they are exported. Every secret reference and SSM parameter name
# here begins with a slash, so without this the service asks Secrets Manager
# for "C:/Program Files/Git/alter/local/..." and gets a ValidationException
# that says nothing about the shell having edited the value.
MSYS_NO_PATHCONV=1
MSYS2_ARG_CONV_EXCL='*'
export MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

if [ ! -f .env.local ]; then
  echo "run-model-gateway-aws: .env.local not found; copy .env.local.example first" >&2
  exit 1
fi

if [ ! -f dist/apps/model-gateway/main.js ]; then
  echo "run-model-gateway-aws: dist/apps/model-gateway/main.js not found; run 'npx nx build model-gateway'" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

# The four variables that decide whether AWS calls reach AWS. Unsetting the
# endpoint and the LocalStack test keys is the whole point of the script:
# leaving either in place silently routes Bedrock to a container that does not
# implement it.
unset AWS_ENDPOINT_URL
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
AWS_PROFILE="${MODEL_GATEWAY_AWS_PROFILE:-alter}"
AWS_REGION="${ALTER_REGION:-ap-south-1}"
export AWS_PROFILE AWS_REGION

# Scoped so the rest of the stack keeps ALTER_CONFIG_SOURCE=mock.
MODEL_GATEWAY_CONFIG_SOURCE=appconfig
export MODEL_GATEWAY_CONFIG_SOURCE

missing=""
for name in APPCONFIG_APPLICATION_ID APPCONFIG_ENVIRONMENT_ID \
  APPCONFIG_CONFIGURATION_PROFILE_ID PLATFORM_ADMIN_SERVICE_TOKEN_SECRET_REF \
  ANTHROPIC_API_KEY_SECRET_REF OPENAI_API_KEY_SECRET_REF \
  PRESIDIO_ANALYZER_URL PRESIDIO_ANONYMIZER_URL CACHE_REDIS_HOST CACHE_REDIS_PORT; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || missing="$missing $name"
done
if [ -n "$missing" ]; then
  echo "run-model-gateway-aws: missing from .env.local:$missing" >&2
  exit 1
fi

echo "model-gateway -> real AWS  region=$AWS_REGION profile=$AWS_PROFILE"
echo "                 appconfig  app=$APPCONFIG_APPLICATION_ID env=$APPCONFIG_ENVIRONMENT_ID profile=$APPCONFIG_CONFIGURATION_PROFILE_ID"
exec node dist/apps/model-gateway/main.js
