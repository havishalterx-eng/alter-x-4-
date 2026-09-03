#!/bin/sh
# Mint an internal service credential from the local mock Auth0 issuer.
#
# Every gRPC and internal HTTP surface in the engine sits behind ServiceAuthGuard,
# which validates a real Auth0 M2M JWT via M2mValidator. There is no bypass for
# local development -- ALTER_CONFIG_SOURCE=mock replaces model providers and AWS
# services, but not authentication. Without a token every call is rejected with
# "Internal service credential is invalid", which reads like a broken service
# rather than a missing credential.
#
# scripts/local-mock-auth0/server.js issues tokens the validator accepts. Start it
# first:
#
#   node scripts/local-mock-auth0/server.js &
#
# Then, to call a service:
#
#   TOKEN=$(sh scripts/local-m2m-token.sh)
#   grpcurl -H "authorization: Bearer $TOKEN" ...
#
# Optional first argument overrides the audience. It must be one the mock issuer
# signs for -- see ISSUER/audience list in server.js. Optional second argument
# overrides the tenant.
set -eu

AUDIENCE="${1:-https://engine.alter.local}"
TENANT="${2:-ten_01930000-0000-7000-8000-000000000001}"
ISSUER_URL="${LOCAL_MOCK_AUTH0_URL:-http://127.0.0.1:4999}"

response=$(
  curl --silent --show-error --fail \
    -X POST "$ISSUER_URL/oauth/token" \
    -H 'content-type: application/json' \
    -d "{\"audience\":\"$AUDIENCE\",\"tenantId\":\"$TENANT\"}"
) || {
  echo "could not reach the mock issuer at $ISSUER_URL" >&2
  echo "start it with: node scripts/local-mock-auth0/server.js &" >&2
  exit 1
}

token=$(printf '%s' "$response" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

if [ -z "$token" ]; then
  echo "issuer responded but returned no access_token: $response" >&2
  exit 1
fi

printf '%s' "$token"
