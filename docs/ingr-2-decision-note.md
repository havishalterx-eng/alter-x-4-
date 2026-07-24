# INGR-2 Rollout Decision

- Feature ID: `INGR-2`
- Feature flag: `ingress.sessionGatewayCore`
- Owner: CEO
- Decision date: 2026-07-25
- Status: `approved_feature_gated`
- Rollout: merge allowed after CI/audit green; production enablement requires actor-token JWKS endpoint deployed and configured.
- Reason: INGR-2 is security-sensitive auth/session gateway; runtime enablement must stay feature-gated until JWKS endpoint is deployed.

## Production Requirements

Production startup requires `INGRESS_SESSION_GATEWAY_CORE_ENABLED=true` and
an explicit `ACTOR_TOKEN_JWKS_URL` that points to the deployed actor-token
JWKS endpoint. This decision does not claim that an endpoint is deployed.

The test signer remains confined to test/development utilities and is excluded
from the production package. Production startup rejects
`ACTOR_TOKEN_TEST_SIGNER_ENABLED=true`.
