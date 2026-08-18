// HTTP client for intelligence-service's performance_records writer.
// FastAPI route (POST /internal/performance/agents/{agent_id}/records), not
// gRPC -- see apps/intelligence-service/src/performance/router.py. Mirrors
// SelectionBindingClient's injectable-fetch pattern rather than inventing a
// new HTTP-calling convention.

export interface PerformanceRecorderHttpClient {
  postJson(url: string, body: unknown): Promise<void>;
}

/**
 * Same fail-closed real-credential convention as SelectionBindingClient's
 * defaultServiceToken -- a missing INTERNAL_SERVICE_TOKEN must not degrade
 * into an anonymous request the callee then has to decide about.
 */
export function createFetchPerformanceRecorderHttpClient(
  readServiceToken: () => string = defaultServiceToken,
): PerformanceRecorderHttpClient {
  return {
    async postJson(url: string, body: unknown): Promise<void> {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${readServiceToken()}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `Performance Recorder request to ${url} failed with status ${response.status}`,
        );
      }
    },
  };
}

export interface PerformanceRecorderClientConfig {
  readonly baseUrl: string;
}

export type PerformanceVerdict = "success" | "failure" | "partial" | "escalated";

export interface RecordPerformanceObservationRequest {
  readonly tenant_id: string;
  readonly run_id?: string;
  readonly node_type?: string;
  readonly task_category?: string;
  readonly verdict: PerformanceVerdict;
  readonly latency_ms?: number;
  readonly token_count?: number;
}

export interface PerformanceRecorderHandler {
  recordObservation(
    agentId: string,
    request: RecordPerformanceObservationRequest,
  ): Promise<void>;
}

export class PerformanceRecorderClient implements PerformanceRecorderHandler {
  constructor(
    private readonly config: PerformanceRecorderClientConfig,
    private readonly httpClient: PerformanceRecorderHttpClient = createFetchPerformanceRecorderHttpClient(),
  ) {}

  async recordObservation(
    agentId: string,
    request: RecordPerformanceObservationRequest,
  ): Promise<void> {
    await this.httpClient.postJson(
      `${this.config.baseUrl}/internal/performance/agents/${agentId}/records`,
      request,
    );
  }
}

function defaultServiceToken(): string {
  const token = process.env["INTERNAL_SERVICE_TOKEN"]?.trim();
  if (!token) {
    throw new Error(
      "INTERNAL_SERVICE_TOKEN is required to call the Performance Recorder",
    );
  }
  return token;
}
