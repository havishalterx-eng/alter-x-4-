# Product Core Exit Check

Run this only after Fixes 1-5 are merged into the same branch. It is a hard
regression gate for the Product Core phase, not a substitute for the full CI
merge gate.

```sh
node scripts/run-product-core-exit-check.mjs
```

The harness fails when an expected proof is absent. It runs the real Platform
and Engine test groups for workflow and project BFF behavior, template
variables, Human Action Centre state transitions, run observability, artifacts,
idempotency database behavior, stale-write rejection, durable SSE replay, permission revocation,
and terminal frames. It also rejects direct Engine URLs or public Engine
environment variables in `apps/platform-web`.

Before phase sign-off, run the full CI merge gate and record these live checks
against a deployed Platform API and real browser session:

1. Workflow goal to Engine-planned draft DAG, canvas metadata save/reload, full
   lifecycle, version/promotion, trigger rotation, and paused-run approval
   resume.
2. Project brief through clarification, plan review, real build output,
   repository/environment/deployment state, and artifact byte-for-byte signed
   download.
3. Browser disconnect/reconnect with `Last-Event-ID`, then mid-stream
   membership removal; confirm resumed ordered events and an actually closed
   connection.
4. Burst run events and a real SandboxExec command; confirm critical ordering,
   xterm-ready stdout/stderr frames, and the configured 15-second heartbeat is
   below the deployed proxy idle timeout.
