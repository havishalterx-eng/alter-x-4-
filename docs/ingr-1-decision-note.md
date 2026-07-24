# INGR-1 Decision Note

## Canonical Event Contract

INGR-1 uses `packages/contracts/src/canonical-event.ts` as the single public canonical event contract. The versioned orchestration path `packages/contracts/orchestration/v1/canonical-event.schema.ts` re-exports that schema instead of defining a second shape.

The orchestration event table mirrors that contract for `signature_status` and payload storage:

- `signature_status`: `verified | unverified | failed`
- `payload` may be `NULL` only when `payload_reference` is present
- `payload_reference` may be `NULL` only when `payload` is present
- `trigger_id` and `trigger_version` must both be present or both be absent; partial trigger linkage is rejected before PostgreSQL composite FK `MATCH SIMPLE` can skip provenance validation.

## CEO Feature Mapping

No CEO-approved `featureFlag` / feature ID for the INGR-1 `orchestration_db` scaffold is present in the repository feature map.

Current status: **blocked_until_ceo_feature_mapping**.
Decision owner: CEO session.
Decision date: pending.
Rollout semantics while pending: INGR-1 may remain on the branch for audit, but it must not merge to `main`, deploy to a shared environment, or enable production traffic until the CEO records either an approved feature ID / feature flag or explicit ungated foundation-schema approval.

Merge remains blocked until one of these happens:

- CEO maps this provider/schema scaffold to an approved feature ID.
- CEO records INGR-1 as an ungated foundation schema with an explicit decision note.
