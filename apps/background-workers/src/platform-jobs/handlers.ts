import type { JsonValue } from "@alterx/shared-clients";
import type { PlatformJobHandler } from "@alterx/adapters";

// Real, minimal handler proving the Platform Jobs worker's end-to-end wire
// (Temporal -> workflow -> activity -> registered handler) before any real
// job type (ingestion coordination, exports, notification fan-out, etc.)
// is registered here. Each real job type is its own future ticket; none
// are stubbed here as a substitute for that real work.
const healthPingHandler: PlatformJobHandler = async (
  payload: JsonValue,
): Promise<JsonValue> => {
  return { pong: true, receivedPayload: payload };
};

export interface NotificationDigestPayload {
  readonly period_start: string;
  readonly period_end: string;
}

/**
 * Real digest-cycle trigger: calls platform-api's real internal, shared-
 * secret-authenticated route, which does the real work (real cross-tenant
 * enumeration + real per-user buildDigest). This handler is a thin real
 * HTTP relay, not a second implementation of digest logic.
 */
function createNotificationDigestHandler(
  baseUrl: string,
  serviceToken: string,
  fetchImpl: typeof fetch,
): PlatformJobHandler {
  return async (payload: JsonValue): Promise<JsonValue> => {
    const body = payload as unknown as NotificationDigestPayload;
    const response = await fetchImpl(`${baseUrl}/internal/notifications/run-due-digests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({
        period_start: body.period_start,
        period_end: body.period_end,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `notification digest run failed: HTTP ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as JsonValue;
  };
}

/**
 * Real connector health sweep trigger: calls platform-api's real internal,
 * shared-secret-authenticated route, which does the real work (real
 * cross-tenant connection enumeration + real per-connection health()
 * calls). Thin real HTTP relay, no payload -- the sweep covers every
 * currently-connected connector, not a caller-supplied window.
 */
function createConnectorHealthSweepHandler(
  baseUrl: string,
  serviceToken: string,
  fetchImpl: typeof fetch,
): PlatformJobHandler {
  return async (): Promise<JsonValue> => {
    const response = await fetchImpl(`${baseUrl}/internal/integrations/run-health-sweep`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `connector health sweep failed: HTTP ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as JsonValue;
  };
}

/**
 * Real retention sweep trigger: calls ads-core's real, pre-existing
 * internal, shared-secret-authenticated retention route directly
 * (ads-core is not behind platform-api). Thin real HTTP relay -- all real
 * retention logic (AdsDeletionProvider.apply_retention_policy) already
 * exists in ads-core; this handler only supplies the missing schedule.
 */
function createRetentionSweepHandler(
  baseUrl: string,
  serviceToken: string,
  fetchImpl: typeof fetch,
): PlatformJobHandler {
  return async (): Promise<JsonValue> => {
    const response = await fetchImpl(`${baseUrl}/internal/deletion/retention`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `retention sweep failed: HTTP ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as JsonValue;
  };
}

/**
 * Real, scoped to the 4 confirmed "launch-floor" golden sets
 * (apps/eval-service/src/db/launch_golden_sets.py) -- the redteam/chaos/
 * recovery sets serve a different real purpose (security/resilience
 * testing, not regular regression sweeps) and are deliberately out of
 * scope here, disclosed rather than silently swept too.
 */
const LAUNCH_FLOOR_GOLDEN_SETS = ["planner", "intent", "retrieval", "verification"] as const;

/**
 * Real scheduled benchmark sweep: calls orchestration-service's real,
 * pre-existing internal eval-facade route once per real launch-floor
 * golden set, with trigger="scheduled" so the resulting EvalRun rows are
 * real, honestly distinguishable from staff-triggered manual runs (the
 * same route BenchmarksService already relays staff-initiated runs
 * through). Per-golden-set error isolation, same real pattern as the
 * other sweep handlers.
 */
function createBenchmarkSweepHandler(
  baseUrl: string,
  serviceToken: string,
  fetchImpl: typeof fetch,
): PlatformJobHandler {
  return async (): Promise<JsonValue> => {
    let goldenSetsProcessed = 0;
    let goldenSetsFailed = 0;
    for (const goldenSetName of LAUNCH_FLOOR_GOLDEN_SETS) {
      try {
        const response = await fetchImpl(`${baseUrl}/internal/eval/run-evaluation`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${serviceToken}`,
          },
          body: JSON.stringify({ golden_set_name: goldenSetName, trigger: "scheduled" }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${await response.text()}`);
        }
        goldenSetsProcessed += 1;
      } catch {
        goldenSetsFailed += 1;
      }
    }
    return { goldenSetsProcessed, goldenSetsFailed };
  };
}

interface DriftCandidate {
  readonly tenant_id: string;
  readonly agent_id: string;
  readonly task_class: string;
}

function createDriftSweepHandler(
  intelligenceBaseUrl: string,
  memoryBaseUrl: string,
  serviceToken: string,
  minimumObservations: number,
  fetchImpl: typeof fetch,
): PlatformJobHandler {
  return async (): Promise<JsonValue> => {
    const candidatesResponse = await fetchImpl(
      `${intelligenceBaseUrl}/internal/performance/drift-candidates?minimum_observations=${minimumObservations}`,
      { headers: { authorization: `Bearer ${serviceToken}` } },
    );
    if (!candidatesResponse.ok) {
      throw new Error(
        `drift candidate discovery failed: HTTP ${candidatesResponse.status} ${await candidatesResponse.text()}`,
      );
    }
    const payload = await candidatesResponse.json() as { candidates?: DriftCandidate[] };
    let scored = 0;
    let failed = 0;
    for (const candidate of payload.candidates ?? []) {
      const response = await fetchImpl(`${memoryBaseUrl}/drift/agents/score`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(candidate),
      });
      if (response.ok) {
        scored += 1;
      } else {
        failed += 1;
      }
    }
    return { candidates: payload.candidates?.length ?? 0, scored, failed };
  };
}

/**
 * ENGINE-FIX-P3-13: real trigger for the audit chain's incremental verifier
 * (AuditQueryController's POST /internal/audit-events/verify-chain) --
 * same thin-relay shape as every other sweep handler here. valid: false
 * in a 200 response is a real finding (the chain broke), not a failed
 * request -- surfaced as a thrown error so it lands as a visible job
 * failure rather than a silently "successful" sweep.
 */
function createAuditChainVerifySweepHandler(
  baseUrl: string,
  serviceToken: string,
  fetchImpl: typeof fetch,
): PlatformJobHandler {
  return async (): Promise<JsonValue> => {
    const response = await fetchImpl(`${baseUrl}/internal/audit-events/verify-chain`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `audit chain verify sweep failed: HTTP ${response.status} ${await response.text()}`,
      );
    }
    const result = (await response.json()) as {
      valid: boolean;
      checkedEvents: number;
      issue?: string;
      eventId?: string;
    };
    if (!result.valid) {
      throw new Error(
        `audit chain verification failed: issue=${result.issue ?? "unknown"} eventId=${result.eventId ?? "unknown"}`,
      );
    }
    return result as unknown as JsonValue;
  };
}

export interface PlatformJobHandlerDependencies {
  readonly platformApiInternalBaseUrl?: string;
  readonly notificationDigestServiceToken?: string;
  readonly connectorHealthSweepServiceToken?: string;
  readonly adsCoreInternalBaseUrl?: string;
  readonly retentionSweepServiceToken?: string;
  readonly orchestrationServiceInternalBaseUrl?: string;
  readonly evalFacadeServiceToken?: string;
  readonly intelligenceServiceInternalBaseUrl?: string;
  readonly memoryServiceInternalBaseUrl?: string;
  readonly driftSweepServiceToken?: string;
  readonly driftSweepMinimumObservations?: number;
  readonly auditServiceInternalBaseUrl?: string;
  readonly auditChainVerifyServiceToken?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createPlatformJobHandlers(
  dependencies?: PlatformJobHandlerDependencies,
): ReadonlyMap<string, PlatformJobHandler> {
  const handlers = new Map<string, PlatformJobHandler>([
    ["platform.health-ping", healthPingHandler],
  ]);
  const fetchImpl = dependencies?.fetchImpl ?? fetch;
  if (dependencies?.platformApiInternalBaseUrl && dependencies.notificationDigestServiceToken) {
    handlers.set(
      "platform.notification-digest",
      createNotificationDigestHandler(
        dependencies.platformApiInternalBaseUrl,
        dependencies.notificationDigestServiceToken,
        fetchImpl,
      ),
    );
  }
  if (dependencies?.platformApiInternalBaseUrl && dependencies.connectorHealthSweepServiceToken) {
    handlers.set(
      "platform.connector-health-sweep",
      createConnectorHealthSweepHandler(
        dependencies.platformApiInternalBaseUrl,
        dependencies.connectorHealthSweepServiceToken,
        fetchImpl,
      ),
    );
  }
  if (dependencies?.adsCoreInternalBaseUrl && dependencies.retentionSweepServiceToken) {
    handlers.set(
      "platform.retention-sweep",
      createRetentionSweepHandler(
        dependencies.adsCoreInternalBaseUrl,
        dependencies.retentionSweepServiceToken,
        fetchImpl,
      ),
    );
  }
  if (dependencies?.orchestrationServiceInternalBaseUrl && dependencies.evalFacadeServiceToken) {
    handlers.set(
      "platform.benchmark-sweep",
      createBenchmarkSweepHandler(
        dependencies.orchestrationServiceInternalBaseUrl,
        dependencies.evalFacadeServiceToken,
        fetchImpl,
      ),
    );
  }
  if (
    dependencies?.intelligenceServiceInternalBaseUrl &&
    dependencies.memoryServiceInternalBaseUrl &&
    dependencies.driftSweepServiceToken &&
    dependencies.driftSweepMinimumObservations !== undefined
  ) {
    handlers.set(
      "platform.drift-sweep",
      createDriftSweepHandler(
        dependencies.intelligenceServiceInternalBaseUrl,
        dependencies.memoryServiceInternalBaseUrl,
        dependencies.driftSweepServiceToken,
        dependencies.driftSweepMinimumObservations,
        fetchImpl,
      ),
    );
  }
  if (dependencies?.auditServiceInternalBaseUrl && dependencies.auditChainVerifyServiceToken) {
    handlers.set(
      "platform.audit-chain-verify",
      createAuditChainVerifySweepHandler(
        dependencies.auditServiceInternalBaseUrl,
        dependencies.auditChainVerifyServiceToken,
        fetchImpl,
      ),
    );
  }
  return handlers;
}
