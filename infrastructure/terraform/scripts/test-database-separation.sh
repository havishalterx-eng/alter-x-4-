#!/usr/bin/env bash
set -euo pipefail

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
alterx_plugin_cache="${TF_PLUGIN_CACHE_DIR:-${TMPDIR:-/tmp}/alterx-terraform-plugin-cache}"

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE
export AWS_EC2_METADATA_DISABLED=true
export TF_PLUGIN_CACHE_DIR="$alterx_plugin_cache"
mkdir -p "$TF_PLUGIN_CACHE_DIR"

terraform -chdir="$terraform_root/modules/data" init -backend=false -input=false >/dev/null
terraform -chdir="$terraform_root/modules/data" test
"$terraform_root/modules/data/tests/bootstrap-acl-isolation.sh"
