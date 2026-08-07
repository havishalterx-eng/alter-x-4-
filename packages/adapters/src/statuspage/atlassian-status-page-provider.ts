import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ProviderHealth,
  ProviderMetadata,
  SecretsProvider,
  StatusPageIncident,
  StatusPageIncidentRequest,
  StatusPageProvider,
} from "@alterx/shared-clients";

export interface AtlassianStatusPageConfig {
  readonly pageId: string;
  readonly apiTokenSecretRef: string;
}

export interface StatusPageHttpRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly authorization: string;
  readonly body?: Readonly<Record<string, unknown>>;
}

export interface StatusPageHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface StatusPageHttpClient {
  request(request: StatusPageHttpRequest): Promise<StatusPageHttpResponse>;
}

export const ATLASSIAN_STATUS_PAGE_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["global"],
  data_residency: ["provider-managed"],
  batch_support: false,
  maximum_payload: 65_536,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const metadata: ProviderMetadata<"StatusPageProvider"> = {
  providerId: "atlassian-statuspage",
  interfaceName: "StatusPageProvider",
  displayName: "Atlassian Statuspage",
  version: "1.0.0",
  telemetryNamespace: "alterx.adapters.atlassian.statuspage",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "atlassian-statuspage-v1",
    rollbackSupported: true,
  },
};

export class AtlassianStatusPageProvider implements StatusPageProvider {
  readonly metadata = metadata;
  readonly capabilities = ATLASSIAN_STATUS_PAGE_CAPABILITIES;

  constructor(
    private readonly config: AtlassianStatusPageConfig,
    private readonly secrets: SecretsProvider,
    private readonly http: StatusPageHttpClient = createFetchStatusPageHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async healthCheck(): Promise<ProviderHealth> {
    const started = this.now().getTime();
    try {
      await this.call("GET", `/pages/${encodeURIComponent(this.config.pageId)}`);
      const checkedAt = this.now();
      return {
        status: "healthy",
        checkedAt: checkedAt.toISOString(),
        latencyMs: checkedAt.getTime() - started,
      };
    } catch {
      const checkedAt = this.now();
      return {
        status: "unhealthy",
        checkedAt: checkedAt.toISOString(),
        latencyMs: checkedAt.getTime() - started,
      };
    }
  }

  async publishIncident(
    request: StatusPageIncidentRequest,
  ): Promise<StatusPageIncident> {
    const response = record(
      await this.call(
        "POST",
        `/pages/${encodeURIComponent(this.config.pageId)}/incidents`,
        {
          incident: {
            name: request.title,
            body: request.body,
            status: request.status,
            impact_override: request.impact,
            deliver_notifications: request.notifySubscribers,
          },
        },
      ),
    );
    return {
      providerIncidentRef: requiredString(response.id, "id"),
      status: status(response.status),
      publishedAt: requiredTimestamp(response.created_at, this.now()),
    };
  }

  private async call(
    method: StatusPageHttpRequest["method"],
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const token = await this.secrets.getSecret(this.config.apiTokenSecretRef);
    const response = await this.http.request({
      method,
      path,
      authorization: `OAuth ${token}`,
      ...(body === undefined ? {} : { body }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new AtlassianStatusPageError(
        response.status,
        "Statuspage operation failed",
      );
    }
    return response.body;
  }
}

export class AtlassianStatusPageError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AtlassianStatusPageError";
  }
}

export function createFetchStatusPageHttpClient(
  baseUrl = "https://api.statuspage.io/v1",
): StatusPageHttpClient {
  return {
    request: async (request) => {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          authorization: request.authorization,
          "content-type": "application/json",
        },
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text.length === 0 ? {} : JSON.parse(text),
      };
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AtlassianStatusPageError(502, "Statuspage returned invalid data");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new AtlassianStatusPageError(502, `Statuspage response missing ${field}`);
}

function status(value: unknown): StatusPageIncident["status"] {
  if (value === "investigating" || value === "monitoring" || value === "resolved") {
    return value;
  }
  throw new AtlassianStatusPageError(502, "Statuspage response has invalid status");
}

function requiredTimestamp(value: unknown, fallback: Date): string {
  if (typeof value !== "string") return fallback.toISOString();
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new AtlassianStatusPageError(502, "Statuspage response has invalid created_at");
  }
  return timestamp.toISOString();
}
