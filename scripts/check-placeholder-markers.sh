#!/usr/bin/env bash
set -euo pipefail

# Wave 3 item 2. This session hit the same root-cause shape four separate
# times going through the hardening audit's Phase 3 waves ("Pattern 3" in
# session notes): a promotion gate, an audit-chain verifier, a Python
# injection classifier, and sandbox-service's browser render verifier were
# each real, correct, tested code sitting behind a dead or unwired path in
# production, and none of it was caught until someone traced the call
# graph by hand. The audit's own fix for this class of bug: a developer
# who KNOWS a wiring path is a stub should be able to say so in a way CI
# enforces, instead of that knowledge living only in a comment nobody
# greps for. This is that marker.
#
# Usage: `// ENGINE-PLACEHOLDER: <reason>` (or `# ENGINE-PLACEHOLDER: <reason>`
# in Python) on a stubbed/not-yet-wired production path. The marker must
# never reach main -- either the path gets wired for real before merge, or
# the work isn't done yet and the PR shouldn't merge either. This check
# exists to make that a CI failure instead of a silent gap that ships.

marker='ENGINE-PLACEHOLDER:'

command -v rg >/dev/null || {
  echo "placeholder-marker check failed: rg not found" >&2
  exit 2
}

set +e
hits="$(rg -n --fixed-strings "$marker" \
  --glob '!**/generated/**' \
  apps packages)"
rg_status=$?
set -e

case "$rg_status" in
  1)
    echo "placeholder-marker check ok: no $marker markers found"
    ;;
  0)
    echo "Placeholder marker violation: code marked with $marker reached main." >&2
    echo "Either finish wiring the path for real, or the change isn't done yet --" >&2
    echo "either way it can't merge with the marker still present." >&2
    echo >&2
    echo "$hits" >&2
    exit 1
    ;;
  *)
    echo "placeholder-marker check failed: rg exited $rg_status" >&2
    exit 2
    ;;
esac
