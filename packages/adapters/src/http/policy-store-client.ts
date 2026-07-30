// HTTP client for memory-service's PolicyStoreService (KNOW-15). That
// service is exposed as FastAPI routes mirroring alter.memory.v1's RPC
// names (POST /memory/update-policy, /promote-memory, /active-policy),
// not gRPC -- see apps/memory-service/src/policy_store/router.py. Mirrors
// PlannerClient's injectable-fetch pattern rather than inventing a new
// HTTP-calling convention.

export interface PolicyStoreHttpClient {
  postJson(url: string, body: unknown): Promise<unknown>;
}

export function createFetchPolicyStoreHttpClient(): PolicyStoreHttpClient {
  return {
    async postJson(url: string, body: unknown): Promise<unknown> {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer orchestration-service",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `Policy Store request to ${url} failed with status ${response.status}`,
        );
      }
      return response.json();
    },
  };
}

export interface PolicyStoreClientConfig {
  readonly baseUrl: string;
}

export interface GetActivePolicyRequest {
  readonly tenant_id: string;
  readonly kind: string;
}

export interface GetActivePolicyResponse {
  readonly found: boolean;
  readonly policy_id: string | null;
  readonly version: number | null;
  readonly body_json: string | null;
}

export interface PolicyStoreHandler {
  getActivePolicy(request: GetActivePolicyRequest): Promise<GetActivePolicyResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class PolicyStoreResponseValidationError extends Error {
  constructor(operation: string, reason: string) {
    super(`Policy Store ${operation} response is invalid: ${reason}`);
    this.name = "PolicyStoreResponseValidationError";
  }
}

function parseGetActivePolicyResponse(raw: unknown): GetActivePolicyResponse {
  if (!isRecord(raw) || typeof raw.found !== "boolean") {
    throw new PolicyStoreResponseValidationError(
      "get_active_policy",
      "missing or mistyped 'found' field",
    );
  }
  const policyId = raw.policy_id;
  const version = raw.version;
  const bodyJson = raw.body_json;
  if (
    (policyId !== null && typeof policyId !== "string") ||
    (version !== null && version !== undefined && typeof version !== "number") ||
    (bodyJson !== null && typeof bodyJson !== "string")
  ) {
    throw new PolicyStoreResponseValidationError(
      "get_active_policy",
      "mistyped policy_id/version/body_json field",
    );
  }
  return {
    found: raw.found,
    policy_id: policyId ?? null,
    version: (version as number | undefined) ?? null,
    body_json: bodyJson ?? null,
  };
}

export class PolicyStoreClient implements PolicyStoreHandler {
  constructor(
    private readonly config: PolicyStoreClientConfig,
    private readonly httpClient: PolicyStoreHttpClient = createFetchPolicyStoreHttpClient(),
  ) {}

  async getActivePolicy(
    request: GetActivePolicyRequest,
  ): Promise<GetActivePolicyResponse> {
    const raw = await this.httpClient.postJson(
      `${this.config.baseUrl}/memory/active-policy`,
      request,
    );
    return parseGetActivePolicyResponse(raw);
  }
}
