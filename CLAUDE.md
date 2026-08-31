# Alter Engine — Session Reference

## What is Alter

Alter — autonomous execution platform. Two modes: **Workflow Mode** (creates, runs, maintains intelligent business workflows) and **Project Mode** (builds, tests, audits, deploys, maintains complete software). One shared Engine. See `README.md` for the full overview.

## Repo layout

Nx + pnpm monorepo, TypeScript/NestJS + Python/FastAPI.

- **15 apps:** `ads-core`, `audit-service`, `background-workers`, `cost-ledger-service`, `eval-service`, `intelligence-service`, `memory-service`, `model-gateway`, `orchestration-service`, `platform-api`, `platform-web`, `provisioning-service`, `sandbox-service`, `tool-gateway`, `verification-service`
- **6 packages:** `adapters`, `auth`, `contracts`, `observability`, `shared-clients`, `tenancy`

See `README.md` "Repository layout" section for descriptions of each.

## Standing rules (all verified against real CI / codebase)

- **Never clone into a cloud-synced folder** (iCloud Desktop on macOS, OneDrive Desktop on Windows). The sync client makes git commands hang unpredictably. Clone somewhere outside the synced tree — `~/alter-work/` is the convention in use.
- **Node 22 pinned via `.nvmrc`.** Testcontainers-based tests fail on Node 20 with a `webidl.util.MarkAsUncloneable` error — do not use Node 20.
- **Check for competing `pnpm` process before `install`/`add`/`update`.** Concurrent installs can corrupt lockfile / `node_modules` state.
- **`buf generate` produces a spurious reorder diff across `packages/contracts/src/generated/`** — not only the compiler file. Any `nx run <project>:typecheck` can trigger it. Run `git checkout -- packages/contracts/src/generated/` before staging if you've touched anything proto-related.
- **Windows: `generate_protos.py --check` fails on CRLF.** protoc emits LF; if git checked the generated Python bindings out as CRLF, the check diffs every file and the build target fails. `.gitattributes` sets `eol=lf`, but on some git-for-windows versions `git checkout` still writes CRLF — in that case rewrite the affected files with `git show HEAD:<path> > <path>` rather than any checkout variant.
- **`scripts/check-architecture-boundaries.sh` is a real, enforced CI gate.** No cross-app relative imports. Also enforced: `check-rbac-classification.sh`, `check-placeholder-markers.sh`, `check-migration-rollback-pairing.sh`.
- **CI `gate` job** (~10 min, no remote cache; Nx computation cache persisted via `actions/cache@v4`). PRs use `nx affected` (lint/typecheck/build/test); pushes to main run full monorepo sweep. Includes: architecture boundary check, RBAC classification, secret scan (gitleaks), dependency audit with baseline diff, proto breaking-change check (`buf breaking`), SBOM generation.
- **Branches are never deleted, under any circumstance.** Always `--squash` merge, never `--delete-branch`, never `--no-verify`, never force-push.

## Local dev

See `docs/local-dev.md` for how to actually run the stack locally.
