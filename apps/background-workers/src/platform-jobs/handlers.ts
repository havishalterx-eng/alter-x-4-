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

export interface PlatformJobHandlerDependencies {
  readonly platformApiInternalBaseUrl: string;
  readonly notificationDigestServiceToken: string;
  readonly fetchImpl?: typeof fetch;
}

export function createPlatformJobHandlers(
  dependencies?: PlatformJobHandlerDependencies,
): ReadonlyMap<string, PlatformJobHandler> {
  const handlers = new Map<string, PlatformJobHandler>([
    ["platform.health-ping", healthPingHandler],
  ]);
  if (dependencies) {
    handlers.set(
      "platform.notification-digest",
      createNotificationDigestHandler(
        dependencies.platformApiInternalBaseUrl,
        dependencies.notificationDigestServiceToken,
        dependencies.fetchImpl ?? fetch,
      ),
    );
  }
  return handlers;
}
