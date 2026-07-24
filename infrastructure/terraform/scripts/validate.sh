#!/usr/bin/env bash
set -euo pipefail

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
alterx_plugin_cache="${TF_PLUGIN_CACHE_DIR:-${TMPDIR:-/tmp}/alterx-terraform-plugin-cache}"

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE
export AWS_EC2_METADATA_DISABLED=true
export TF_PLUGIN_CACHE_DIR="$alterx_plugin_cache"
mkdir -p "$TF_PLUGIN_CACHE_DIR"

terraform fmt -check -recursive "$terraform_root"

validation_directories=(
  "$terraform_root"
  "$terraform_root/modules/account"
  "$terraform_root/modules/compute"
  "$terraform_root/modules/data"
  "$terraform_root/modules/ecr"
  "$terraform_root/modules/environment"
  "$terraform_root/modules/messaging"
  "$terraform_root/modules/network"
  "$terraform_root/modules/runtime-config"
  "$terraform_root/modules/scp"
  "$terraform_root/environments/management"
  "$terraform_root/environments/log-archive"
  "$terraform_root/environments/security"
  "$terraform_root/environments/shared-services"
  "$terraform_root/environments/dev"
  "$terraform_root/environments/staging"
  "$terraform_root/environments/prod"
  "$terraform_root/environments/sandbox-exec"
)

for directory in "${validation_directories[@]}"; do
  terraform -chdir="$directory" init -backend=false -input=false >/dev/null
  terraform -chdir="$directory" validate
done

"$terraform_root/scripts/test-database-separation.sh"
