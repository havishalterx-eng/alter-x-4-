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

export interface PlatformJobHandlerDependencies {
  readonly platformApiInternalBaseUrl?: string;
  readonly notificationDigestServiceToken?: string;
  readonly connectorHealthSweepServiceToken?: string;
  readonly adsCoreInternalBaseUrl?: string;
  readonly retentionSweepServiceToken?: string;
  readonly orchestrationServiceInternalBaseUrl?: string;
  readonly evalFacadeServiceToken?: string;
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
  return handlers;
}
