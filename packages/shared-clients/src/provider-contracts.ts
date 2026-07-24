import { ProviderCapabilitiesSchema } from "@alterx/contracts";
import type { ProviderContractSuite } from "./contract-testing";
import type {
  DurableExecutionProvider,
  ObservabilityProvider,
  SecretsProvider,
} from "./provider-types";

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejects(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

export const secretsProviderContract: ProviderContractSuite<SecretsProvider> = {
  name: "SecretsProvider",
  cases: [
    {
      name: "publishes valid base-provider metadata and capabilities",
      assert: async (provider) => {
        ensure(
          provider.metadata.interfaceName === "SecretsProvider",
          "Secrets adapter must identify its canonical interface",
        );
        ProviderCapabilitiesSchema.parse(provider.capabilities);
        const health = await provider.healthCheck();
        ensure(
          health.status === "healthy",
          "Contract fixture must be healthy",
        );
        return {
          capabilities: provider.capabilities,
          health,
          interfaceName: provider.metadata.interfaceName,
        };
      },
    },
    {
      name: "resolves a secret exclusively through its reference ID",
      assert: async (provider) => {
        const secret = await provider.getSecret("contract/secret");
        ensure(
          secret === "contract-secret-value",
          "Known contract secret must resolve deterministically",
        );
        ensure(
          await rejects(() => provider.getSecret("contract/missing")),
          "Unknown secret references must be rejected",
        );
        return { resolved: true };
      },
    },
  ],
};

export const observabilityProviderContract: ProviderContractSuite<ObservabilityProvider> =
  {
    name: "ObservabilityProvider",
    cases: [
      {
        name: "publishes valid base-provider metadata and capabilities",
        assert: async (provider) => {
          ensure(
            provider.metadata.interfaceName === "ObservabilityProvider",
            "Observability adapter must identify its canonical interface",
          );
          ProviderCapabilitiesSchema.parse(provider.capabilities);
          const health = await provider.healthCheck();
          ensure(
            health.status === "healthy",
            "Contract fixture must be healthy",
          );
          return {
            capabilities: provider.capabilities,
            health,
            interfaceName: provider.metadata.interfaceName,
          };
        },
      },
      {
        name: "accepts normalized traces",
        assert: (provider) =>
          provider.emitTrace({
            traceId: "0123456789abcdef0123456789abcdef",
            spanId: "0123456789abcdef",
            name: "contract.trace",
            startedAt: "2026-07-22T00:00:00.000Z",
          }),
      },
      {
        name: "accepts normalized metrics",
        assert: (provider) =>
          provider.emitMetric({
            name: "contract.metric",
            value: 1,
            recordedAt: "2026-07-22T00:00:00.000Z",
            unit: "count",
          }),
      },
      {
        name: "accepts normalized logs",
        assert: (provider) =>
          provider.emitLog({
            severity: "info",
            message: "contract log",
            recordedAt: "2026-07-22T00:00:00.000Z",
          }),
      },
      {
        name: "accepts normalized error captures",
        assert: (provider) =>
          provider.captureError({
            name: "ContractError",
            message: "contract error",
            occurredAt: "2026-07-22T00:00:00.000Z",
            traceId: "0123456789abcdef0123456789abcdef",
            spanId: "0123456789abcdef",
          }),
      },
    ],
  };

export const durableExecutionProviderContract: ProviderContractSuite<DurableExecutionProvider> =
  {
    name: "DurableExecutionProvider",
    cases: [
      {
        name: "publishes valid base-provider metadata and capabilities",
        assert: async (provider) => {
          ensure(
            provider.metadata.interfaceName === "DurableExecutionProvider",
            "Durable adapter must identify its canonical interface",
          );
          ProviderCapabilitiesSchema.parse(provider.capabilities);
          const health = await provider.healthCheck();
          ensure(
            health.status === "healthy",
            "Contract fixture must be healthy",
          );
          return {
            capabilities: provider.capabilities,
            health,
            interfaceName: provider.metadata.interfaceName,
          };
        },
      },
      {
        name: "supports a complete durable workflow lifecycle",
        assert: async (provider) => {
          const handle = await provider.startWorkflow({
            workflowId: "contract-workflow",
            workflowType: "contract",
            input: { attempt: 1 },
          });
          ensure(
            handle.workflowId === "contract-workflow",
            "Started workflow ID must remain canonical",
          );

          await provider.signalWorkflow({
            workflowId: handle.workflowId,
            signalName: "contract-signal",
            payload: { approved: true },
          });
          const running = await provider.queryWorkflow({
            workflowId: handle.workflowId,
            queryName: "status",
          });
          ensure(
            JSON.stringify(running.value) ===
              JSON.stringify({ status: "running", terminationReason: null }),
            "Workflow must report running before termination",
          );

          await provider.terminateWorkflow({
            workflowId: handle.workflowId,
            reason: "contract complete",
          });
          const terminated = await provider.queryWorkflow({
            workflowId: handle.workflowId,
            queryName: "status",
          });
          ensure(
            JSON.stringify(terminated.value) ===
              JSON.stringify({
                status: "terminated",
                terminationReason: "contract complete",
              }),
            "Workflow termination must be queryable",
          );
          return { handle, running, terminated };
        },
      },
    ],
  };
