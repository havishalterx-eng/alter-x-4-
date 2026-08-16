#!/bin/sh
set -eu

: "${ACTOR_TOKEN_SIGNING_KEY_REF:?ACTOR_TOKEN_SIGNING_KEY_REF is required}"

if awslocal ssm get-parameter \
  --name "$ACTOR_TOKEN_SIGNING_KEY_REF" \
  --with-decryption >/dev/null 2>&1; then
  echo "Platform API actor signing key already exists"
  exit 0
fi

umask 077
key_file="$(mktemp)"
trap 'rm -f "$key_file"' EXIT

openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:2048 \
  -out "$key_file" >/dev/null 2>&1

awslocal ssm put-parameter \
  --name "$ACTOR_TOKEN_SIGNING_KEY_REF" \
  --type SecureString \
  --value "file://$key_file" >/dev/null

echo "Platform API actor signing key ready"
