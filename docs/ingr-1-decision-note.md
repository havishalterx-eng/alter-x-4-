# INGR-1 Decision Note

## Canonical Event Contract

INGR-1 uses `packages/contracts/src/canonical-event.ts` as the single public canonical event contract. The versioned orchestration path `packages/contracts/orchestration/v1/canonical-event.schema.ts` re-exports that schema instead of defining a second shape.

The orchestration event table mirrors that contract for `signature_status` and payload storage:

- `signature_status`: `verified | unverified | failed`
- `payload` may be `NULL` only when `payload_reference` is present
- `payload_reference` may be `NULL` only when `payload` is present
- `trigger_id` and `trigger_version` must both be present or both be absent; partial trigger linkage is rejected before PostgreSQL composite FK `MATCH SIMPLE` can skip provenance validation.

## CEO Feature Mapping

CEO decision: INGR-1 approved as ungated foundation schema.
Feature ID/flag: none required.
Reason: schema/contracts/migrations foundation only; no user-facing rollout behavior.
Owner: CEO
Decision date: 2026-07-25
Rollout: merge allowed after CI/audit green; no runtime feature gate required.
