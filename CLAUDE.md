# Alter Engine — Session Reference

## What is Alter

Alter — autonomous execution platform. Two modes: **Workflow Mode** (creates, runs, maintains intelligent business workflows) and **Project Mode** (builds, tests, audits, deploys, maintains complete software). One shared Engine. See `README.md` for the full overview.

## Repo layout

Nx + pnpm monorepo, TypeScript/NestJS + Python/FastAPI.

- **15 apps:** `ads-core`, `audit-service`, `background-workers`, `cost-ledger-service`, `eval-service`, `intelligence-service`, `memory-service`, `model-gateway`, `orchestration-service`, `platform-api`, `platform-web`, `provisioning-service`, `sandbox-service`, `tool-gateway`, `verification-service`
- **6 packages:** `adapters`, `auth`, `contracts`, `observability`, `shared-clients`, `tenancy`

See `README.md` "Repository layout" section for descriptions of each.

## Standing rules (all verified against real CI / codebase)

- **Git work lives under `/private/tmp/`, never `~/Desktop`.** iCloud Desktop sync causes git commands to hang unpredictably on Mac.
- **Node 22 pinned via `.nvmrc`.** Testcontainers-based tests fail on Node 20 with a `webidl.util.MarkAsUncloneable` error — do not use Node 20.
- **Check for competing `pnpm` process before `install`/`add`/`update`.** Concurrent installs can corrupt lockfile / `node_modules` state.
- **`buf generate` produces a spurious reorder diff** on `packages/contracts/src/generated/alter/compiler/v1/compiler.ts` — check for it before every commit if you've touched anything proto-related.
- **`scripts/check-architecture-boundaries.sh` is a real, enforced CI gate.** No cross-app relative imports. Also enforced: `check-rbac-classification.sh`, `check-placeholder-markers.sh`, `check-migration-rollback-pairing.sh`.
- **CI `gate` job** (~10 min, no remote cache; Nx computation cache persisted via `actions/cache@v4`). PRs use `nx affected` (lint/typecheck/build/test); pushes to main run full monorepo sweep. Includes: architecture boundary check, RBAC classification, secret scan (gitleaks), dependency audit with baseline diff, proto breaking-change check (`buf breaking`), SBOM generation.
- **Branches are never deleted, under any circumstance.** Always `--squash` merge, never `--delete-branch`, never `--no-verify`, never force-push.

## Local dev

See `docs/local-dev.md` for how to actually run the stack locally.
