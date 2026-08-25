// HTTP client for intelligence-service's PlannerService (PLAN-3). That
// service is exposed as FastAPI routes mirroring alter.planner.v1's RPC
// names (POST /planner/decompose, /replan, /select-strategy), not gRPC --
// see apps/intelligence-service/src/planner/router.py. Mirrors the
// Presidio/Tavily adapters' injectable-fetch pattern rather than
// inventing a new HTTP-calling convention.

export interface PlannerHttpClient {
  postJson(url: string, body: unknown): Promise<unknown>;
}

/**
 * Same fail-closed real-credential convention as PolicyStoreClient's/
 * SelectionBindingClient's defaultServiceToken -- a missing
 * INTERNAL_SERVICE_TOKEN must not degrade into an anonymous request the
 * callee then has to decide about. ENGINE-FIX-P5-SEC-1: every route this
 * client calls now sits behind intelligence-service's app-level auth
 * dependency.
 */
export function createFetchPlannerHttpClient(
  readServiceToken: () => string = defaultServiceToken,
): PlannerHttpClient {
  return {
    async postJson(url: string, body: unknown): Promise<unknown> {
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
          `Planner request to ${url} failed with status ${response.status}`,
        );
      }
      return response.json();
    },
  };
}

function defaultServiceToken(): string {
  const token = process.env["INTERNAL_SERVICE_TOKEN"]?.trim();
  if (!token) {
    throw new Error("INTERNAL_SERVICE_TOKEN is required to call the Planner");
  }
  return token;
}

export interface PlannerClientConfig {
  readonly baseUrl: string;
}

export interface DecomposeRequest {
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly run_id: string;
  readonly strategy: string;
  readonly problem_spec_json: string;
}

export interface ProblemContextReference {
  readonly document_id: string;
  readonly chunk_reference: string;
  readonly confidence: number;
  readonly provenance_json: string;
}

export interface ProblemSpec {
  readonly objective: string;
  readonly current_situation: string | null;
  readonly actors: readonly string[];
  readonly systems_involved: readonly string[];
  readonly constraints: readonly string[];
  readonly required_data: readonly string[];
  readonly risk: string;
  readonly missing_information: readonly string[];
  readonly success_criteria: readonly string[];
  readonly context_references: readonly ProblemContextReference[];
}

export interface ProblemUnderstandingRequest {
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly run_id: string;
  readonly objective: string;
  readonly actor_context?: Readonly<Record<string, string>>;
}

export interface DecomposeResponse {
  readonly task_skeleton_json: string;
  readonly ambiguity_detected: boolean;
  readonly clarification_questions: readonly string[];
}

export interface SelectStrategyRequest {
  readonly tenant_id: string;
  readonly objective: string;
  readonly mode: string;
}

export interface SelectStrategyResponse {
  readonly strategy: string;
  readonly reason: string;
}

export interface ReplanRequest {
  readonly tenant_id: string;
  readonly run_id: string;
  readonly current_dag_json: string;
  readonly failure_context_json: string;
}

export interface ReplanResponse {
  readonly revised_skeleton_json: string;
  readonly reason: string;
}

export interface PreparedCompilerInput {
  readonly status: "ready" | "blocked";
  readonly architecture?: unknown;
  readonly binding_decision?: unknown;
}

export interface PlannerHandler {
  understand(request: ProblemUnderstandingRequest): Promise<ProblemSpec>;
  decompose(request: DecomposeRequest): Promise<DecomposeResponse>;
  selectStrategy(request: SelectStrategyRequest): Promise<SelectStrategyResponse>;
  replan(request: ReplanRequest): Promise<ReplanResponse>;
  prepareCompilerInput?(request: { readonly tenant_id: string; readonly workspace_id: string; readonly task_skeleton: unknown }): Promise<PreparedCompilerInput>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class PlannerResponseValidationError extends Error {
  constructor(operation: string, reason: string) {
    super(`Planner ${operation} response is invalid: ${reason}`);
    this.name = "PlannerResponseValidationError";
  }
}

function parseDecomposeResponse(raw: unknown): DecomposeResponse {
  if (
    !isRecord(raw) ||
    typeof raw.task_skeleton_json !== "string" ||
    typeof raw.ambiguity_detected !== "boolean" ||
    !Array.isArray(raw.clarification_questions) ||
    !raw.clarification_questions.every((q) => typeof q === "string")
  ) {
    throw new PlannerResponseValidationError("decompose", "missing or mistyped fields");
  }
  return {
    task_skeleton_json: raw.task_skeleton_json,
    ambiguity_detected: raw.ambiguity_detected,
    clarification_questions: raw.clarification_questions as readonly string[],
  };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseProblemSpec(raw: unknown): ProblemSpec {
  if (
    !isRecord(raw) ||
    typeof raw.objective !== "string" ||
    !(raw.current_situation === null || typeof raw.current_situation === "string") ||
    !isStringArray(raw.actors) ||
    !isStringArray(raw.systems_involved) ||
    !isStringArray(raw.constraints) ||
    !isStringArray(raw.required_data) ||
    typeof raw.risk !== "string" ||
    !isStringArray(raw.missing_information) ||
    !isStringArray(raw.success_criteria) ||
    !Array.isArray(raw.context_references)
  ) {
    throw new PlannerResponseValidationError("understand", "missing or mistyped fields");
  }
  return raw as unknown as ProblemSpec;
}

function parseSelectStrategyResponse(raw: unknown): SelectStrategyResponse {
  if (
    !isRecord(raw) ||
    typeof raw.strategy !== "string" ||
    typeof raw.reason !== "string"
  ) {
    throw new PlannerResponseValidationError("select_strategy", "missing or mistyped fields");
  }
  return { strategy: raw.strategy, reason: raw.reason };
}

function parseReplanResponse(raw: unknown): ReplanResponse {
  if (
    !isRecord(raw) ||
    typeof raw.revised_skeleton_json !== "string" ||
    typeof raw.reason !== "string"
  ) {
    throw new PlannerResponseValidationError("replan", "missing or mistyped fields");
  }
  return { revised_skeleton_json: raw.revised_skeleton_json, reason: raw.reason };
}

export class PlannerClient implements PlannerHandler {
  constructor(
    private readonly config: PlannerClientConfig,
    private readonly httpClient: PlannerHttpClient = createFetchPlannerHttpClient(),
  ) {}

  async understand(request: ProblemUnderstandingRequest): Promise<ProblemSpec> {
    const raw = await this.httpClient.postJson(
      `${this.config.baseUrl}/internal/problem-understanding/understand`,
      request,
    );
    return parseProblemSpec(raw);
  }

  async decompose(request: DecomposeRequest): Promise<DecomposeResponse> {
    const raw = await this.httpClient.postJson(
      `${this.config.baseUrl}/planner/decompose`,
      request,
    );
    return parseDecomposeResponse(raw);
  }

  async selectStrategy(
    request: SelectStrategyRequest,
  ): Promise<SelectStrategyResponse> {
    const raw = await this.httpClient.postJson(
      `${this.config.baseUrl}/planner/select-strategy`,
      request,
    );
    return parseSelectStrategyResponse(raw);
  }

  async replan(request: ReplanRequest): Promise<ReplanResponse> {
    const raw = await this.httpClient.postJson(
      `${this.config.baseUrl}/planner/replan`,
      request,
    );
    return parseReplanResponse(raw);
  }

  async prepareCompilerInput(request: { readonly tenant_id: string; readonly workspace_id: string; readonly task_skeleton: unknown }): Promise<PreparedCompilerInput> {
    const raw = await this.httpClient.postJson(`${this.config.baseUrl}/internal/architecture-synthesis/prepare-compiler-input`, request);
    if (!isRecord(raw) || (raw.status !== "ready" && raw.status !== "blocked")) throw new PlannerResponseValidationError("prepare_compiler_input", "invalid response");
    if (raw.status === "ready" && (raw.architecture === undefined || raw.binding_decision === undefined)) throw new PlannerResponseValidationError("prepare_compiler_input", "missing architecture binding");
    return raw as unknown as PreparedCompilerInput;
  }
}
