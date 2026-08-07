# Phase 9 k6 Load Suite

The scripts exercise real deployed endpoints only. They require a non-production
load environment, an `ACCESS_TOKEN`, and paths/body values matching seeded data
in that environment; no in-process mock server is provided.

Run each script from `tests/load/k6` with k6 installed:

```powershell
k6 run -e BASE_URL=https://staging.example -e ACCESS_TOKEN=... -e API_READ_PATH=/api/v1/runs -e API_CONTROL_PATH=/api/v1/triggers -e API_CONTROL_BODY='{}' api-mix.js
```

`run-start.js` additionally requires `RUN_START_PATH` and `RUN_START_BODY`.
`event-ingestion.js` additionally requires `EVENT_INGEST_PATH` and
`EVENT_INGEST_BODY`. Each run writes a JSON summary under `results/` and fails
when a Test Plan SLO floor is breached.

`sse-reconnect.js` uses the auto-resolved `k6/x/sse` community extension and
requires `RUN_STREAM_PATH` for a seeded run that emits at least one replayable
event, for example `/stream/runs/run_...`, plus `STREAM_HEALTH_PATH`. It measures
real connection acceptance and p95 connection latency under burst reconnects,
then probes gateway health during the storm to detect resource exhaustion.
