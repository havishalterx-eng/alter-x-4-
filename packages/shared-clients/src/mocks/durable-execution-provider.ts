import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  DurableExecutionProvider,
  JsonValue,
  ProviderMetadata,
  SignalWorkflowRequest,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_DURABLE_EXECUTION_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(1_048_576),
  streaming: true,
};

export class DurableWorkflowAlreadyExistsError extends Error {
  public readonly workflowId: string;

  public constructor(workflowId: string) {
    super(`Durable workflow already exists: ${workflowId}`);
    this.name = "DurableWorkflowAlreadyExistsError";
    this.workflowId = workflowId;
  }
}

export class DurableWorkflowNotFoundError extends Error {
  public readonly workflowId: string;

  public constructor(workflowId: string) {
    super(`Durable workflow was not found: ${workflowId}`);
    this.name = "DurableWorkflowNotFoundError";
    this.workflowId = workflowId;
  }
}

export class UnsupportedWorkflowQueryError extends Error {
  public readonly queryName: string;

  public constructor(queryName: string) {
    super(`Durable workflow query is unsupported: ${queryName}`);
    this.name = "UnsupportedWorkflowQueryError";
    this.queryName = queryName;
  }
}

interface MockWorkflowRecord {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly input: JsonValue;
  readonly signals: SignalWorkflowRequest[];
  status: "running" | "terminated";
  terminationReason?: string;
}

export interface MockDurableExecutionProvider extends DurableExecutionProvider {
  listWorkflowIds(): readonly string[];
}

export interface MockDurableExecutionProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"DurableExecutionProvider">;
  readonly capabilities?: ProviderCapabilities;
}

export function createMockDurableExecutionProvider(
  options: MockDurableExecutionProviderOptions = {},
): MockDurableExecutionProvider {
  const providerId = options.providerId ?? "mock.durable-execution";
  const workflows = new Map<string, MockWorkflowRecord>();

  const getWorkflow = (workflowId: string): MockWorkflowRecord => {
    const workflow = workflows.get(workflowId);
    if (workflow === undefined) {
      throw new DurableWorkflowNotFoundError(workflowId);
    }
    return workflow;
  };

  return createMockProvider<MockDurableExecutionProvider>({
    metadata:
      options.metadata ??
      mockMetadata(providerId, "DurableExecutionProvider"),
    capabilities: options.capabilities ?? MOCK_DURABLE_EXECUTION_CAPABILITIES,
    implementation: {
      startWorkflow: async (request) => {
        if (workflows.has(request.workflowId)) {
          throw new DurableWorkflowAlreadyExistsError(request.workflowId);
        }

        workflows.set(request.workflowId, {
          workflowId: request.workflowId,
          workflowType: request.workflowType,
          input: request.input,
          signals: [],
          status: "running",
        });
        return {
          workflowId: request.workflowId,
          runId: `${request.workflowId}:mock-run`,
        };
      },
      signalWorkflow: async (request) => {
        const workflow = getWorkflow(request.workflowId);
        if (workflow.status !== "running") {
          throw new Error("Cannot signal a terminated durable workflow");
        }
        workflow.signals.push({ ...request });
      },
      queryWorkflow: async (request) => {
        const workflow = getWorkflow(request.workflowId);
        let value: JsonValue;

        switch (request.queryName) {
          case "input":
            value = workflow.input;
            break;
          case "signals":
            value = workflow.signals.map((signal) => ({
              signalName: signal.signalName,
              payload: signal.payload,
            }));
            break;
          case "status":
            value = {
              status: workflow.status,
              terminationReason: workflow.terminationReason ?? null,
            };
            break;
          default:
            throw new UnsupportedWorkflowQueryError(request.queryName);
        }

        return {
          workflowId: request.workflowId,
          queryName: request.queryName,
          value,
        };
      },
      terminateWorkflow: async (request) => {
        const workflow = getWorkflow(request.workflowId);
        workflow.status = "terminated";
        workflow.terminationReason = request.reason;
      },
      listWorkflowIds: () => Object.freeze([...workflows.keys()]),
    },
  });
}
