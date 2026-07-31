# Phase 9 Promotion Gate

Run only after staging has produced real evidence for every listed check. The gate is fail-closed: missing values, failed checks, or absent approvals result in `blocked` and a non-zero exit code. An `approved` decision is the only condition under which Engine may be declared backend-complete.

```bash
export PROMOTION_EVIDENCE_PATH=/secure/release/phase9-evidence.json
pnpm exec nx run eval-service:promotion-gate
```

The evidence object requires `subject`, `candidate`, `environment: "staging_to_prod"`, all nine Test Plan threshold metrics, true values for `staging_e2e`, `golden_sets`, `redteam`, `chaos`, `load_slo`, `backup_restore`, `deletion_ledger_replay`, and `canary_rollback`, plus approvals from `subsystem_owners`, `ceo`, and `product_owner`.

The stored `release_gates` row is append-only and includes the canonical evidence digest and every blocking reason. Do not run this gate with generated, mock, or locally assumed evidence.
