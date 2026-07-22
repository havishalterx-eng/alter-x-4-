#!/usr/bin/env bash
set -euo pipefail

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE
export AWS_EC2_METADATA_DISABLED=true

terraform -chdir="$terraform_root" init -reconfigure -input=false >/dev/null
terraform -chdir="$terraform_root" plan \
  -input=false \
  -lock=false \
  -refresh=false \
  -var-file=terraform.tfvars.example \
  -var=mock_provider=true \
  -var=enable_existing_account_imports=false

terraform -chdir="$terraform_root/environments/dev" init -reconfigure -input=false >/dev/null
terraform -chdir="$terraform_root/environments/dev" plan \
  -input=false \
  -lock=false \
  -refresh=false \
  -var-file=terraform.tfvars.example \
  -var=mock_provider=true
