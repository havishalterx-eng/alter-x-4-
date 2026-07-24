import { Client, Connection } from "@temporalio/client";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  DurableExecutionProvider,
  DurableWorkflowHandle,
  ProviderHealth,
  ProviderMetadata,
  SignalWorkflowRequest,
  StartWorkflowRequest,
  TerminateWorkflowRequest,
  WorkflowQueryRequest,
  WorkflowQueryResult,
} from "@alterx/shared-clients";

export const TEMPORAL_HEALTH_TIMEOUT_MS = 2_000;

export interface TemporalConnectionConfig {
  readonly address: string;
  readonly namespace: string;
  readonly apiKey?: string;
  readonly taskQueue: string;
}

export class TemporalConfigurationError extends Error {
  constructor(field: keyof TemporalConnectionConfig) {
    super(`Temporal connection config field "${field}" must be non-empty`);
    this.name = "TemporalConfigurationError";
  }
}

const TEMPORAL_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: [],
  data_residency: [],
  batch_support: false,
  maximum_payload: 2_000_000,
  supported_languages: [],
  cost_model: { rates: [] },
};

const TEMPORAL_METADATA: ProviderMetadata<"DurableExecutionProvider"> = {
  providerId: "temporal",
  interfaceName: "DurableExecutionProvider",
  displayName: "Temporal Durable Execution",
  version: "1.20.3",
  telemetryNamespace: "alterx.adapters.temporal",
  featureFlag: "temporal-durable-execution",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "temporal-replay-v1",
    rollbackSupported: true,
  },
};

function assertNonEmpty(
  field: keyof TemporalConnectionConfig,
  value: string | undefined,
): void {
  if (value === undefined || value.trim().length === 0) {
    throw new TemporalConfigurationError(field);
  }
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

export class TemporalDurableExecutionProvider
  implements DurableExecutionProvider
{
  readonly metadata = TEMPORAL_METADATA;
  readonly capabilities = TEMPORAL_CAPABILITIES;

  readonly #config: TemporalConnectionConfig;
  readonly #injectedConnection: Connection | undefined;
  #connectionPromise: Promise<Connection> | undefined;
  #clientPromise: Promise<Client> | undefined;

  constructor(config: TemporalConnectionConfig, connection?: Connection) {
    assertNonEmpty("address", config.address);
    assertNonEmpty("namespace", config.namespace);
    assertNonEmpty("taskQueue", config.taskQueue);
    if (config.apiKey !== undefined) {
      assertNonEmpty("apiKey", config.apiKey);
    }

    this.#config = Object.freeze({ ...config });
    this.#injectedConnection = connection;
  }

  async startWorkflow(
    request: StartWorkflowRequest,
  ): Promise<DurableWorkflowHandle> {
    const client = await this.#getClient();
    const handle = await client.workflow.start(request.workflowType, {
      taskQueue: this.#config.taskQueue,
      workflowId: request.workflowId,
      args: [request.input],
    });

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    };
  }

  async signalWorkflow(request: SignalWorkflowRequest): Promise<void> {
    const client = await this.#getClient();
    await client.workflow
      .getHandle(request.workflowId)
      .signal(request.signalName, request.payload);
  }

  async queryWorkflow(
    request: WorkflowQueryRequest,
  ): Promise<WorkflowQueryResult> {
    const client = await this.#getClient();
    const value = (await client.workflow
      .getHandle(request.workflowId)
      .query(request.queryName)) as WorkflowQueryResult["value"];

    return {
      workflowId: request.workflowId,
      queryName: request.queryName,
      value,
    };
  }

  async terminateWorkflow(request: TerminateWorkflowRequest): Promise<void> {
    const client = await this.#getClient();
    await client.workflow.getHandle(request.workflowId).terminate(request.reason);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startedAt = process.hrtime.bigint();
    const deadline = Date.now() + TEMPORAL_HEALTH_TIMEOUT_MS;
    try {
      const connection = await this.#getConnection();
      await connection.withDeadline(
        deadline,
        async () =>
          connection.workflowService.describeNamespace({
            namespace: this.#config.namespace,
          }),
      );

      return {
        status: "healthy",
        checkedAt: new Date().toISOString(),
        latencyMs: elapsedMilliseconds(startedAt),
        details: { namespaceReachable: true },
      };
    } catch (error: unknown) {
      return {
        status: "unhealthy",
        checkedAt: new Date().toISOString(),
        latencyMs: elapsedMilliseconds(startedAt),
        details: {
          namespaceReachable: false,
          errorType: error instanceof Error ? error.name : "UnknownError",
        },
      };
    }
  }

  async close(): Promise<void> {
    if (this.#injectedConnection !== undefined) {
      return;
    }

    const connection = await this.#connectionPromise?.catch(() => undefined);
    await connection?.close();
  }

  #getConnection(): Promise<Connection> {
    if (this.#injectedConnection !== undefined) {
      return Promise.resolve(this.#injectedConnection);
    }

    this.#connectionPromise ??= Connection.connect({
      address: this.#config.address,
      connectTimeout: TEMPORAL_HEALTH_TIMEOUT_MS,
      ...(this.#config.apiKey === undefined
        ? {}
        : { apiKey: this.#config.apiKey, tls: true }),
    });
    return this.#connectionPromise;
  }

  #getClient(): Promise<Client> {
    this.#clientPromise ??= this.#getConnection().then(
      (connection) =>
        new Client({
          connection,
          namespace: this.#config.namespace,
        }),
    );
    return this.#clientPromise;
  }
}
