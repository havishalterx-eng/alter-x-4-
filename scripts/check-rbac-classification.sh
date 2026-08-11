#!/usr/bin/env bash
set -euo pipefail

# Finding 7: identity.controller.ts had 9 routes and zero RBAC decorators.
# RbacGuard denies unclassified routes by default, so this fails safe at
# request time -- but it fails safe by accident, and it hid three real
# authorization defects (7a/7b/7c) behind the resulting 403 for weeks.
# This check makes "a controller with routes but no RBAC classification"
# a CI failure instead of something only discovered by running the app.
#
# Method matches SECURITY-REVIEW/BOLA-AUDIT.md's own classification sweep
# (d): a controller carrying an HTTP-verb decorator must carry at least one
# RBAC decorator somewhere in the file. File-level, not route-level -- the
# audit itself used this granularity and it is what caught Finding 7.

app_dir="apps/platform-api/src"

if [[ ! -d "$app_dir" ]]; then
  echo "rbac-classification check failed: $app_dir not found" >&2
  exit 2
fi

command -v rg >/dev/null || {
  echo "rbac-classification check failed: rg not found" >&2
  exit 2
}

rbac_decorators='@Public\(\)|@RequireTenantRole|@RequireWorkspaceRole|@RequireStaffRole|@RequirePermission'
http_verbs='@(Get|Post|Put|Patch|Delete)\('

unclassified=()

while IFS= read -r -d '' file; do
  set +e
  has_routes="$(rg -c --pcre2 "$http_verbs" "$file")"
  rg_status=$?
  set -e
  if [[ "$rg_status" -eq 1 ]]; then
    continue # no routes in this controller -- nothing to classify
  elif [[ "$rg_status" -ne 0 ]]; then
    echo "rbac-classification check failed: rg exited $rg_status scanning $file" >&2
    exit 2
  fi
  [[ "$has_routes" -eq 0 ]] && continue

  set +e
  rg -q --pcre2 "$rbac_decorators" "$file"
  classified_status=$?
  set -e
  case "$classified_status" in
    0) ;; # at least one RBAC decorator present -- fine
    1) unclassified+=("$file") ;;
    *)
      echo "rbac-classification check failed: rg exited $classified_status scanning $file" >&2
      exit 2
      ;;
  esac
done < <(find "$app_dir" -name '*.controller.ts' -not -name '*.spec.ts' -print0)

if [[ "${#unclassified[@]}" -gt 0 ]]; then
  echo "RBAC classification violation: controller(s) declare routes but carry no" >&2
  echo "@Public() / @RequireTenantRole / @RequireWorkspaceRole / @RequireStaffRole /" >&2
  echo "@RequirePermission decorator anywhere in the file." >&2
  echo "RbacGuard denies these by default today (fail-safe), but that only shows up" >&2
  echo "at request time and can mask real authorization defects underneath (Finding 7)." >&2
  echo >&2
  printf '  - %s\n' "${unclassified[@]}" >&2
  exit 1
fi

echo "rbac-classification ok"
