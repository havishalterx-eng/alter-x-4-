# Batch 7 Decision Note — Platform Live

The last batch of the Probe-Decide-Rebuild plan. The question it exists to
answer: **how much of the platform is genuinely connected, and are the mock
modules worth wiring in this repository or only in the next one.**

Run on 2026-09-04 against the local stack, with platform-api and platform-web
both running for the first time on this machine — platform-api had never been
started against this stack in Batches 0–6, which is why three of the findings
below had never had an opportunity to surface.

Method: `VITE_API_MODE=live`, signed in through the mock identity provider, then
every surface in the router visited with `fetch` instrumented, recording whether
each one produced an HTTP request at all. Counts come from
`node scripts/batch7-api-surface.mjs`, which derives them from the source rather
than from this note, and stays correct as the code changes.

## The headline

**81 of 207 API methods (39%) can reach a server. The other 126 are mock in
every mode, including live.** 20 of the 21 API modules — every file under
`src/api/services/` — have no live path at all.

Of the 126: **69 are mutations** that report success to the user without
contacting the server, and **57 are reads** that render invented data as real.

## What a click actually does, per surface

| Surface | Live? | What happens |
|---|---|---|
| Dashboard, Workflows, Runs | yes | real engine data (see caveat below) |
| Events, Connections | yes | `/api/v1/events`, `/api/v1/integrations` |
| Settings → profile, sessions, workspace, members, credentials | yes | real |
| Projects | **404** | frontend calls `/api/v1/projects`; platform-api has no such route |
| Human Actions | **400** | `/api/v1/action-centre?status=open` rejected |
| Knowledge → sources | **404** | `/api/v1/ads/sources` — ads-core not routed here |
| Connections → WhatsApp / Voice | **500 / 404** | routes answer, handlers do not |
| Artifacts, Conversations, Knowledge (retrieval/memory/data), Workflow health | none | no request; entirely invented |
| Marketplace (3), Seller (5), Usage (3), Billing (4), Notifications, Discover, Benchmarks | none | 19 surfaces, zero requests between them |
| Settings → security, language, notifications, roles, webhooks, audit, support | none | no request |
| **Admin console — all 14 surfaces** | none | zero requests, while platform-api serves the routes |

### The admin console is the clearest single case

Every one of the 14 admin surfaces makes no request. platform-api maps and
enforces the matching routes — `/api/v1/admin/providers`,
`/api/v1/admin/policy/feature-flags`, `/api/v1/admin/incidents`,
`/api/v1/admin/marketplace/governance`, `/api/v1/admin/audit-events` and
`/api/v1/admin/tenants` all answer `403 RBAC_ROLE_DENIED` for a non-admin, which
is a route that exists and is authorizing, not a missing one. The backend was
built and the frontend edge was never connected: the same "mechanism built, edge
never wired" pattern Batches 5 and 6 found in `ArchitectureBinder` and in agent
drift.

## Three findings that only running it live could produce

### 1. The platform → engine trust boundary could not work at all

Every Engine-proxied route failed with `502 UPSTREAM_SERVICE_ERROR`. The cause
was a three-way disagreement about actor ("delegation") tokens, all three sides
shipped in `.env.local.example`:

| | platform-api mints | engine expected |
|---|---|---|
| signing key | `ACTOR_TOKEN_SIGNING_KEY_REF`, published at its own `/.well-known/actor-jwks.json` | the mock Auth0 server's JWKS |
| issuer | `alter-platform-api.identity-broker` | `https://identity.alter.local/` |
| audience | `alter-engine` | `https://engine.alter.local` |

The key mismatch is the load-bearing one and is not a typo: the mock Auth0 server
generates its own ephemeral keypair at startup for M2M tokens and never sees the
actor-token key, so **no actor token platform-api mints could ever validate** —
confirmed by comparing the two RSA moduli, which differ.

Corrected in `.env.local.example`, after which the full chain
platform-web → platform-api → orchestration-service → `engine_db` worked: a
workflow created through the API came back `201`, listed, and rendered in the UI.
This is the first time that path has run.

### 2. A 502 was indistinguishable from an empty workspace

`live.getDashboardSummary` swallows both engine calls with `.catch(() => [])`.
While every request was failing, the dashboard rendered a confident
"Active Workflows 0 / Runs Today 0" — failure presented as fact, with nothing on
screen to distinguish the two.

The same function spreads `...fallback` — the *mock* summary — over the result.
So beside those two real zeros sat "Success Rate 96.4%" and "Human Actions 7",
which are the literal constants at `src/api/mock/data.ts:116-117`, still shown
after the engine was fixed and returning real data. **Wired does not mean real:
one four-tile row mixes live values and mock constants with no visual
distinction.**

### 3. A data-export request reports success and sends nothing

Settings → Data & Privacy → "Request Data Export" returns the green confirmation
*"Export request generated. A download link will be emailed to you shortly."*
with **zero** network requests. `requestDataExport` is one of the 69 silent
mutations. `deleteWorkspaceData` sits directly beneath it on the same page,
behind a "This action cannot be undone" warning, and is equally unwired.

This is the case the plan singles out as unsafe wherever it runs, now confirmed
against a running system rather than inferred from the source.

## Verdicts

**The twenty mock modules: wire them in the next repository, not this one.** They
are not partially connected — they are 126 methods with no live path and, for the
admin console, a working backend they simply never call. There is nothing to port
and nothing to preserve; wiring them here means writing the edge twice, against
contracts that are being replaced.

**The platform edge that is wired: port it.** Once the actor-token configuration
was corrected the whole spine — identity, workspaces, members, credentials,
workflows, runs, node types, events, integrations — worked end to end on the
first try. The gateway-style chokepoint at platform-api is sound; only its
configuration was wrong.

**Fix the silent mutations here regardless of the rebuild decision**, per the
plan's standing exception, and fail loudly rather than wiring them. An erasure or
export request that reports success is unsafe in any repository, including one
that is about to be replaced. `scripts/batch7-api-surface.mjs` prints the
checklist of all 69.

## Reproducing

```bash
node scripts/batch7-api-surface.mjs        # the checklist, derived from source
```

For the click-through, see the platform-api and platform-web sections of
`docs/local-dev.md` — including the environment variables neither service
documents, which are what kept this batch from starting.
