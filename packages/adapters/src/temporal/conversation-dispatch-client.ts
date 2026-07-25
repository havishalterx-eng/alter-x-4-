import { Client, Connection } from "@temporalio/client";

import type { JsonValue } from "@alterx/shared-clients";

export interface ConversationDispatchConfig {
  readonly address: string;
  readonly namespace: string;
  readonly apiKey?: string;
  readonly taskQueue: string;
}

export class ConversationDispatchConfigurationError extends Error {
  constructor(field: keyof ConversationDispatchConfig) {
    super(`Conversation dispatch config field "${field}" must be non-empty`);
    this.name = "ConversationDispatchConfigurationError";
  }
}

export interface DispatchConversationMessageRequest {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly workflowInput: JsonValue;
  readonly signalName: string;
  readonly signalPayload: JsonValue;
}

export interface DispatchConversationMessageResult {
  readonly workflowId: string;
  readonly signaledRunId: string;
}

export interface ConversationDispatchHandler {
  dispatchMessage(
    request: DispatchConversationMessageRequest,
  ): Promise<DispatchConversationMessageResult>;
}

function assertNonEmpty(
  field: keyof ConversationDispatchConfig,
  value: string | undefined,
): void {
  if (value === undefined || value.trim().length === 0) {
    throw new ConversationDispatchConfigurationError(field);
  }
}

// Deliberately separate from TemporalDurableExecutionProvider: that
// generic adapter's queryWorkflow() has its queryName locked to the
// Foundation phase's demo workflow ("input"|"signals"|"status"), and its
// startWorkflow()/signalWorkflow() don't expose signalWithStart semantics
// at all. Rather than widen that locked shared-clients contract for one
// caller, this is a small purpose-built adapter over the same
// @temporalio/client SDK, matching the ModelGatewayClient/AuditServiceClient
// precedent of separate concrete adapters per concern instead of one
// mega-interface.
export class ConversationDispatchClient implements ConversationDispatchHandler {
  readonly #config: ConversationDispatchConfig;
  readonly #injectedConnection: Connection | undefined;
  #connectionPromise: Promise<Connection> | undefined;
  #clientPromise: Promise<Client> | undefined;

  constructor(config: ConversationDispatchConfig, connection?: Connection) {
    assertNonEmpty("address", config.address);
    assertNonEmpty("namespace", config.namespace);
    assertNonEmpty("taskQueue", config.taskQueue);
    if (config.apiKey !== undefined) {
      assertNonEmpty("apiKey", config.apiKey);
    }

    this.#config = Object.freeze({ ...config });
    this.#injectedConnection = connection;
  }

  async dispatchMessage(
    request: DispatchConversationMessageRequest,
  ): Promise<DispatchConversationMessageResult> {
    const client = await this.#getClient();
    const handle = await client.workflow.signalWithStart(request.workflowType, {
      workflowId: request.workflowId,
      taskQueue: this.#config.taskQueue,
      args: [request.workflowInput],
      signal: request.signalName,
      signalArgs: [request.signalPayload],
    });

    return {
      workflowId: handle.workflowId,
      signaledRunId: handle.signaledRunId,
    };
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
