#!/bin/sh
# Start the eval-only helper servers the golden sets need, on fixed ports.
#
# Why this exists
# ---------------
# eval-service dials 28 addresses. Some are the production services; the rest
# are dedicated eval-only entrypoints that exist because production's own
# main.ts cannot serve the case:
#
#   * the HTTP ones apply SessionGatewayGuard globally, so a request without a
#     real signed JWT is a 401 -- not the 404 the tenant-isolation golden set
#     asserts, and not a route that answers at all for the security cases;
#   * production main.ts boots the whole monolith (Temporal, Planner, every
#     pool) where the case under test needs one service;
#   * ads-core's eval gRPC server seeds the golden set's own 12-document
#     corpus and its scope, which production's entrypoint does not.
#
# tests/test_orchestrator_integration.py spawns each of these on an ephemeral
# port and points eval-service at whatever the OS assigned. That is invisible
# from outside pytest, which is why the golden sets had never been run by hand.
# This script assigns the same helpers fixed ports, so .env.local can name them.
#
# docs/runbooks/eval-golden-sets.md carries the full address-by-address
# mapping, including which of the 28 are production services and stay so.
#
# WHAT THIS WRITES TO
# -------------------
# The harness gives each helper its own throwaway Postgres. This script points
# them at the local compose databases instead, so they run their migrations
# and seed their fixture rows into YOUR local orchestration_db, platform_db
# and ads_db. That is fine for a dev stack and is the point -- the retrieval
# golden set needs that seeded corpus -- but do not aim this at anything whose
# contents you care about.
#
# Usage:
#   set -a; . ./.env.local; set +a
#   sh scripts/run-eval-helpers.sh            # start every helper
#   sh scripts/run-eval-helpers.sh security   # start one (or several)
#   sh scripts/run-eval-helpers.sh --env      # print the matching addresses
#   sh scripts/run-eval-helpers.sh --stop     # stop what this script started
#
# Requires the eval entrypoints to be built:
#   npx nx run-many -t build --projects=orchestration-service,platform-api,tool-gateway
# and, for the retrieval helper, apps/ads-core/.venv (uv sync there first).
set -eu

# Git Bash rewrites values that look like Unix paths when they are exported.
# EVAL_CREDENTIAL_REF below begins with a slash, and NODE_PATH is a colon-
# separated list Git Bash also mangles.
MSYS_NO_PATHCONV=1
MSYS2_ARG_CONV_EXCL='*'
export MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL

repo_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

run_dir="$repo_root/.eval-helpers"
log_dir="$run_dir/logs"

# --- fixed ports ---------------------------------------------------------
# Chosen from the gaps in the port map .env.local.example already assigns.
# Changing one here means changing it there too; nothing derives one from the
# other, because .env.local has to be readable without running this script.
PORT_SECURITY=3005
PORT_RUN_VISIBILITY=3006
PORT_WORKFLOW_READ=3007
PORT_PROJECT_READ=3008
PORT_TRIGGER_REGISTRY=3011
PORT_CREDENTIAL=3012
PORT_IDEMPOTENCY_A=3013
PORT_IDEMPOTENCY_B=3014
PORT_TOOL_CONSUME_HTTP=3015
PORT_RECOVERY_GRPC=50071
PORT_TOOL_CONSUME_GRPC=50072
PORT_RETRIEVAL_GRPC=50073

# --- fixture identifiers -------------------------------------------------
# These are not arbitrary. eval-service's own orchestrator.py asserts against
# the same literals, and ads-core's eval_grpc_server.py seeds its corpus under
# them, so a different value scores zero rather than failing loudly. Kept
# byte-identical to tests/test_orchestrator_integration.py's constants.
EVAL_ADS_TENANT="018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"
EVAL_ADS_WORKSPACE="018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"
EVAL_ADS_SCOPE="scp_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"
EVAL_RUN_VISIBILITY_TENANT="ten_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"
EVAL_WORKFLOW_TENANT="018f4d6e-ffff-7fff-8fff-ffffffffffff"
EVAL_CREDENTIAL_TENANT="018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb"
EVAL_IDEMPOTENCY_TENANT_B="018f4d6e-cccc-7ccc-8ccc-cccccccccccc"
EVAL_TOOL_CONSUME_REF="/alter/prod/tenant/ten_018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb/integration/itg_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee/eval-secret"

ALL_HELPERS="security run-visibility workflow-read project-read trigger-registry recovery credential idempotency-a idempotency-b tool-consume retrieval"

print_env() {
  cat <<ENVBLOCK
# Addresses served by scripts/run-eval-helpers.sh. Every other eval-service
# address is a production service -- see docs/runbooks/eval-golden-sets.md.
SECURITY_EVAL_BASE_URL=http://127.0.0.1:$PORT_SECURITY
RUN_VISIBILITY_BASE_URL=http://127.0.0.1:$PORT_RUN_VISIBILITY
WORKFLOW_BASE_URL=http://127.0.0.1:$PORT_WORKFLOW_READ
PROJECT_BASE_URL=http://127.0.0.1:$PORT_PROJECT_READ
TRIGGER_REGISTRY_BASE_URL=http://127.0.0.1:$PORT_TRIGGER_REGISTRY
CREDENTIAL_BASE_URL=http://127.0.0.1:$PORT_CREDENTIAL
IDEMPOTENCY_TENANT_A_BASE_URL=http://127.0.0.1:$PORT_IDEMPOTENCY_A
IDEMPOTENCY_TENANT_B_BASE_URL=http://127.0.0.1:$PORT_IDEMPOTENCY_B
RECOVERY_GRPC_TARGET=127.0.0.1:$PORT_RECOVERY_GRPC
TOOL_CONSUME_GRPC_TARGET=127.0.0.1:$PORT_TOOL_CONSUME_GRPC
RETRIEVAL_GRPC_TARGET=127.0.0.1:$PORT_RETRIEVAL_GRPC
TENANT_ISOLATION_RETRIEVAL_GRPC_TARGET=127.0.0.1:$PORT_RETRIEVAL_GRPC
ENVBLOCK
}

stop_all() {
  if [ ! -d "$run_dir" ]; then
    echo "run-eval-helpers: nothing started from here"
    return 0
  fi
  for pid_file in "$run_dir"/*.pid; do
    [ -e "$pid_file" ] || continue
    name="$(basename "$pid_file" .pid)"
    pid="$(cat "$pid_file")"
    if kill "$pid" 2>/dev/null; then
      echo "stopped $name (pid $pid)"
    else
      echo "$name (pid $pid) was already gone"
    fi
    rm -f "$pid_file"
  done
}

case "${1:-}" in
  --env) print_env; exit 0 ;;
  --stop) stop_all; exit 0 ;;
esac

if [ ! -f .env.local ]; then
  echo "run-eval-helpers: .env.local not found; copy .env.local.example first" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

: "${ORCHESTRATION_DB_URL:?ORCHESTRATION_DB_URL is required (source .env.local first)}"
: "${PLATFORM_DB_URL:?PLATFORM_DB_URL is required}"
: "${EVAL_ADS_DB_URL:?EVAL_ADS_DB_URL is required}"

requested="${*:-$ALL_HELPERS}"

mkdir -p "$run_dir" "$log_dir"

# Relative on purpose: every helper runs with the repo root as its cwd, and a
# Git Bash absolute path ("/c/Users/...") is read by Windows node as
# "C:\c\Users\..." -- which is how EVAL_MIGRATIONS_DIR first failed here.
node_path="node_modules"

# Start one helper: name, port to wait on, then the command in "$@".
# Env for each is exported by the caller immediately before invoking this,
# which is why every launch below is wrapped in its own subshell.
start_helper() {
  name="$1"
  port="$2"
  shift 2
  if [ -f "$run_dir/$name.pid" ] && kill -0 "$(cat "$run_dir/$name.pid")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$run_dir/$name.pid")) on port $port"
    return 0
  fi
  "$@" >"$log_dir/$name.log" 2>&1 &
  pid=$!
  echo "$pid" >"$run_dir/$name.pid"
  waited=0
  # 40s matches the harness's own _wait_for_port timeout for the helpers that
  # run migrations on startup; the others are up in well under a second.
  while [ "$waited" -lt 40 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name exited during startup -- see $log_dir/$name.log" >&2
      rm -f "$run_dir/$name.pid"
      return 1
    fi
    if node -e "require('net').connect($port,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
      echo "started $name on 127.0.0.1:$port (pid $pid)"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$name did not open port $port within 40s -- see $log_dir/$name.log" >&2
  return 1
}

require_dist() {
  if [ ! -f "$1" ]; then
    echo "run-eval-helpers: $1 not found; run 'npx nx run $2:build'" >&2
    exit 1
  fi
}

orchestration_dist="dist/apps/orchestration-service"
platform_dist="dist/apps/platform-api/eval_credential_http_server.js"
toolgw_dist="dist/apps/tool-gateway/eval_credential_grpc_server.js"

for helper in $requested; do
  case "$helper" in
    security)
      require_dist "$orchestration_dist/eval_security_http_server.js" orchestration-service
      ( export NODE_PATH="$node_path" \
               HTTP_PORT="$PORT_SECURITY" \
               MODEL_GATEWAY_GRPC_TARGET="${MODEL_GATEWAY_GRPC_TARGET:-127.0.0.1:50051}"
        start_helper security "$PORT_SECURITY" node "$orchestration_dist/eval_security_http_server.js" )
      ;;
    run-visibility)
      require_dist "$orchestration_dist/eval_run_visibility_http_server.js" orchestration-service
      ( export NODE_PATH="$node_path" \
               HTTP_PORT="$PORT_RUN_VISIBILITY" \
               EVAL_RUN_VISIBILITY_DB_URL="$ORCHESTRATION_DB_URL" \
               EVAL_TENANT_ID="$EVAL_RUN_VISIBILITY_TENANT"
        start_helper run-visibility "$PORT_RUN_VISIBILITY" node "$orchestration_dist/eval_run_visibility_http_server.js" )
      ;;
    workflow-read)
      require_dist "$orchestration_dist/eval_workflow_read_http_server.js" orchestration-service
      ( export NODE_PATH="$node_path" \
               HTTP_PORT="$PORT_WORKFLOW_READ" \
               EVAL_WORKFLOW_READ_DB_URL="$ORCHESTRATION_DB_URL" \
               EVAL_TENANT_ID="$EVAL_RUN_VISIBILITY_TENANT"
        start_helper workflow-read "$PORT_WORKFLOW_READ" node "$orchestration_dist/eval_workflow_read_http_server.js" )
      ;;
    project-read)
      require_dist "$orchestration_dist/eval_project_read_http_server.js" orchestration-service
      ( export NODE_PATH="$node_path" \
               HTTP_PORT="$PORT_PROJECT_READ" \
               EVAL_PROJECT_READ_DB_URL="$ORCHESTRATION_DB_URL" \
               EVAL_TENANT_ID="$EVAL_RUN_VISIBILITY_TENANT"
        start_helper project-read "$PORT_PROJECT_READ" node "$orchestration_dist/eval_project_read_http_server.js" )
      ;;
    trigger-registry)
      require_dist "$orchestration_dist/eval_trigger_registry_http_server.js" orchestration-service
      ( export NODE_PATH="$node_path" \
               HTTP_PORT="$PORT_TRIGGER_REGISTRY" \
               EVAL_TRIGGER_REGISTRY_DB_URL="$ORCHESTRATION_DB_URL" \
               EVAL_TENANT_ID="$EVAL_WORKFLOW_TENANT"
        start_helper trigger-registry "$PORT_TRIGGER_REGISTRY" node "$orchestration_dist/eval_trigger_registry_http_server.js" )
      ;;
    recovery)
      require_dist "$orchestration_dist/eval_recovery_grpc_server.js" orchestration-service
      ( export NODE_PATH="$node_path" \
               GRPC_BIND_ADDRESS="127.0.0.1:$PORT_RECOVERY_GRPC" \
               EVAL_RECOVERY_DB_URL="$ORCHESTRATION_DB_URL"
        start_helper recovery "$PORT_RECOVERY_GRPC" node "$orchestration_dist/eval_recovery_grpc_server.js" )
      ;;
    credential)
      require_dist "$platform_dist" platform-api
      ( export NODE_PATH="$node_path" \
               HTTP_PORT="$PORT_CREDENTIAL" \
               DATABASE_URL="$PLATFORM_DB_URL" \
               EVAL_TENANT_ID="$EVAL_CREDENTIAL_TENANT" \
               EVAL_MIGRATIONS_DIR="apps/platform-api/src/db/migrations"
        start_helper credential "$PORT_CREDENTIAL" node "$platform_dist" )
      ;;
    idempotency-a)
      require_dist "$platform_dist" platform-api
      ( export NODE_PATH="$node_path" \
               HTTP_PORT="$PORT_IDEMPOTENCY_A" \
               DATABASE_URL="$PLATFORM_DB_URL" \
               EVAL_TENANT_ID="$EVAL_CREDENTIAL_TENANT" \
               EVAL_MIGRATIONS_DIR="apps/platform-api/src/db/migrations"
        start_helper idempotency-a "$PORT_IDEMPOTENCY_A" node "$platform_dist" )
      ;;
    idempotency-b)
      require_dist "$platform_dist" platform-api
      # Same binary as idempotency-a, different tenant: the idempotency
      # evaluation replays one request as two tenants and asserts they do not
      # see each other's result.
      ( export NODE_PATH="$node_path" \
               HTTP_PORT="$PORT_IDEMPOTENCY_B" \
               DATABASE_URL="$PLATFORM_DB_URL" \
               EVAL_TENANT_ID="$EVAL_IDEMPOTENCY_TENANT_B" \
               EVAL_MIGRATIONS_DIR="apps/platform-api/src/db/migrations"
        start_helper idempotency-b "$PORT_IDEMPOTENCY_B" node "$platform_dist" )
      ;;
    tool-consume)
      require_dist "$toolgw_dist" tool-gateway
      ( export NODE_PATH="$node_path" \
               GRPC_BIND_ADDRESS="127.0.0.1:$PORT_TOOL_CONSUME_GRPC" \
               HTTP_PORT="$PORT_TOOL_CONSUME_HTTP" \
               EVAL_CREDENTIAL_REF="$EVAL_TOOL_CONSUME_REF" \
               EVAL_SECRET_VALUE="eval-secret-value"
        start_helper tool-consume "$PORT_TOOL_CONSUME_GRPC" node "$toolgw_dist" )
      ;;
    retrieval)
      ads_python="apps/ads-core/.venv/bin/python"
      if [ ! -x "$ads_python" ]; then
        ads_python="apps/ads-core/.venv/Scripts/python.exe"
      fi
      if [ ! -x "$ads_python" ]; then
        echo "run-eval-helpers: apps/ads-core/.venv not present; run 'uv sync' in apps/ads-core" >&2
        exit 1
      fi
      # This one seeds the golden set's own 12-document corpus and its scope
      # on startup. Pointing RETRIEVAL_GRPC_TARGET at ads-core's production
      # AdsqService instead is why the retrieval set scored 0/20: production
      # has neither the corpus nor the scope, and refusing an unknown scope is
      # correct tenant isolation, not a defect.
      ( cd apps/ads-core
        export EVAL_ADS_DB_URL="$EVAL_ADS_DB_URL" \
               ADS_CORE_SERVICE_ROOT="." \
               EVAL_ADS_TENANT_ID="$EVAL_ADS_TENANT" \
               EVAL_ADS_WORKSPACE_ID="$EVAL_ADS_WORKSPACE" \
               EVAL_ADS_SCOPE_ID="$EVAL_ADS_SCOPE" \
               GRPC_BIND_ADDRESS="127.0.0.1:$PORT_RETRIEVAL_GRPC" \
               INTERNAL_SERVICE_TOKEN_SHA256="${INTERNAL_SERVICE_TOKEN_SHA256:-}"
        start_helper retrieval "$PORT_RETRIEVAL_GRPC" "$repo_root/$ads_python" -m src.query.eval_grpc_server )
      ;;
    *)
      echo "run-eval-helpers: unknown helper '$helper'; known: $ALL_HELPERS" >&2
      exit 1
      ;;
  esac
done

echo
echo "logs: $log_dir"
echo "stop: sh scripts/run-eval-helpers.sh --stop"
