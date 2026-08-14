import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";

import {
  ModelGatewayClient,
  PostgresOrchestrationStoreProvider,
  type ModelGatewayHandler,
} from "@alterx/adapters";
import type { RecoveryClassifyFailureRequest } from "@alterx/contracts";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecoveryDispatchService } from "./recovery-dispatch.service";
import {
  RecoveryNodeNotFoundError,
  RecoveryPolicyService,
  RecoveryRootCauseUnavailableError,
} from "./recovery-policy.service";

// HEAL-6: classifyFailure (this spec's whole surface) never calls dispatch
// -- selectStrategy does. A stub satisfies the constructor without
// pretending this spec exercises real strategy dispatch.
const NOOP_DISPATCH = {
  dispatch: vi.fn().mockResolvedValue({ outcome: "resolved", detail: "unused in this spec" }),
} as unknown as RecoveryDispatchService;

const migrationsFolder = resolve(
  process.cwd(),
  "apps/orchestration-service/drizzle",
);
const modelGatewayProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/modelgw/v1/modelgw.proto",
);
const TENANT_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const TENANT_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b1";
const TENANT_A_REQUEST = `ten_${TENANT_A}`;
const TENANT_B_REQUEST = `ten_${TENANT_B}`;
const WORKSPACE = "018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const RUN_A = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890a3";
const RUN_B = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890b3";
const INFRA_NODE = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890a4";
const LOGIC_NODE = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890a5";

interface RecoveryRow extends Record<string, unknown> {
  readonly failure_class: string;
  readonly root_cause_estimate: Record<string, unknown>;
  readonly strategy: string | null;
  readonly policy_version: string | null;
}

function request(
  tenantId: string,
  runId: string,
  nodeExecutionId: string,
  observation: Record<string, unknown>,
): RecoveryClassifyFailureRequest {
  return {
    tenant_id: tenantId,
    run_id: runId,
    node_execution_id: nodeExecutionId,
    error_json: JSON.stringify({
      trace_id: "trc_018f47a5-7b2c-7d10-8f11-123456789abc",
      request_id: "req_018f47a5-7b2c-7d10-8f11-123456789abc",
      ...observation,
    }),
  };
}

async function closedLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not allocate a local gRPC port");
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) =>
      error === undefined ? resolveClose() : reject(error),
    );
  });
  return address.port;
}

describe.sequential("RecoveryPolicyService PostgreSQL integration", () => {
  let postgres: StartedPostgreSqlContainer;
  let adminStore: PostgresOrchestrationStoreProvider;
  let recoveryStore: PostgresOrchestrationStoreProvider;
  let service: RecoveryPolicyService;
  const role = `heal5_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const invoke = vi.fn(async () => ({
    // Real provider responses (packages/adapters/src/aws/bedrock-model-provider.ts)
    // wrap output_json as {message: {role, content}, stop_reason} -- content
    // itself is the JSON-encoded root-cause payload.
    output_json: JSON.stringify({
      message: {
        role: "assistant",
        content: JSON.stringify({
          explanation: "The observed execution signal identifies the failing layer.",
          confidence: 0.95,
          evidence: ["durable node error", "verification result"],
        }),
      },
      stop_reason: "end_turn",
    }),
    usage_json: "{}",
    resolved_capability: "ADVANCED:test-model",
  }));
  let idSequence = 0;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:16.6-alpine")
      .withDatabase("orchestration_db")
      .withUsername("orchestration_admin")
      .withPassword(randomBytes(24).toString("hex"))
      .start();
    adminStore = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: postgres.getConnectionUri(),
      migrationsFolder,
    });
    await adminStore.migrate();
    await adminStore.withTenant(TENANT_A, async (tx) => {
      await tx.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      await tx.query(`GRANT CONNECT ON DATABASE orchestration_db TO ${role}`);
      await tx.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await tx.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
      );
    });
    recoveryStore = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: `postgresql://${role}:${password}@${postgres.getHost()}:${postgres.getPort()}/${postgres.getDatabase()}`,
      migrationsFolder,
    });
    service = new RecoveryPolicyService(
      recoveryStore,
      { invoke } as unknown as ModelGatewayHandler,
      NOOP_DISPATCH,
      () => {
        idSequence += 1;
        return `rec_018f47a5-7b2c-7d10-8f11-${String(idSequence).padStart(12, "0")}`;
      },
    );
  }, 90_000);

  afterAll(async () => {
    await recoveryStore?.close();
    await adminStore?.withTenant(TENANT_A, async (tx) => {
      await tx.query(`DROP OWNED BY ${role}`);
      await tx.query(`DROP ROLE IF EXISTS ${role}`);
    });
    await adminStore?.close();
    await postgres?.stop();
  }, 60_000);

  beforeEach(async () => {
    invoke.mockClear();
    idSequence = 0;
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await adminStore.withTenant(tenantId, async (tx) => {
        await tx.query("DELETE FROM recovery_actions WHERE tenant_id = $1", [
          tenantId,
        ]);
        await tx.query("DELETE FROM node_executions WHERE tenant_id = $1", [
          tenantId,
        ]);
        await tx.query("DELETE FROM runs WHERE tenant_id = $1", [tenantId]);
      });
    }
    await seedRun(TENANT_A, RUN_A);
    await seedRun(TENANT_B, RUN_B);
    await seedFailedNode(TENANT_A, RUN_A, INFRA_NODE, {
      code: "SANDBOX_BUILD_INFRA_FAILURE",
      retryable: true,
    });
    await seedFailedNode(TENANT_A, RUN_A, LOGIC_NODE, {
      code: "SANDBOX_RENDER_PLACEHOLDER_DETECTED",
    });
  });

  async function seedRun(tenantId: string, runId: string): Promise<void> {
    await adminStore.withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO runs (id, tenant_id, workspace_id, parent_kind, status)
         VALUES ($1, $2, $3, 'workflow', 'failed')`,
        [runId, tenantId, WORKSPACE],
      );
    });
  }

  async function seedFailedNode(
    tenantId: string,
    runId: string,
    nodeId: string,
    error: Record<string, unknown>,
  ): Promise<void> {
    await adminStore.withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO node_executions
           (id, tenant_id, run_id, dag_node_id, node_type, attempt, status, error)
         VALUES ($1, $2, $3, 'sandbox_node', 'SandboxExec', 2, 'failed', $4::jsonb)`,
        [nodeId, tenantId, runId, JSON.stringify(error)],
      );
    });
  }

  async function recoveryRows(): Promise<readonly RecoveryRow[]> {
    return recoveryStore.withTenant(TENANT_A, async (tx) => {
      const result = await tx.query<RecoveryRow>(
        `SELECT failure_class, root_cause_estimate, strategy, policy_version
         FROM recovery_actions
         WHERE tenant_id = $1
         ORDER BY node_execution_id`,
        [TENANT_A],
      );
      return result.rows;
    });
  }

  it("classifies real persisted infra and logic failures and leaves strategy to HEAL-6", async () => {
    const infra = await service.classifyFailure(
      request(TENANT_A_REQUEST, RUN_A, INFRA_NODE, {
        verification: {
          kind: "build",
          status: "infra_failure",
          error_code: "SANDBOX_BUILD_INFRA_FAILURE",
        },
      }),
    );
    const logic = await service.classifyFailure(
      request(TENANT_A_REQUEST, RUN_A, LOGIC_NODE, {
        verification: {
          kind: "render",
          status: "logic_failure",
          error_code: "SANDBOX_RENDER_LOGIC_FAILURE",
        },
      }),
    );

    expect(infra.failure_class).toBe("infrastructure_failure");
    expect(logic.failure_class).toBe("logic_output_failure");
    expect(await recoveryRows()).toEqual([
      expect.objectContaining({
        failure_class: "infrastructure_failure",
        strategy: null,
        policy_version: null,
      }),
      expect.objectContaining({
        failure_class: "logic_output_failure",
        strategy: null,
        policy_version: null,
      }),
    ]);
  });

  it("rejects a cross-tenant node lookup before invoking ADVANCED", async () => {
    await expect(
      service.classifyFailure(
        request(TENANT_B_REQUEST, RUN_B, INFRA_NODE, {}),
      ),
    ).rejects.toBeInstanceOf(RecoveryNodeNotFoundError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed through the real ModelGatewayClient when gRPC is unreachable", async () => {
    const port = await closedLocalPort();
    const unavailableModelGateway = new ModelGatewayClient({
      address: `127.0.0.1:${port}`,
      protoPath: modelGatewayProtoPath,
      timeoutMs: 500,
    });
    const unavailableService = new RecoveryPolicyService(
      recoveryStore,
      unavailableModelGateway,
      NOOP_DISPATCH,
    );

    await expect(
      unavailableService.classifyFailure(
        request(TENANT_A_REQUEST, RUN_A, INFRA_NODE, {}),
      ),
    ).rejects.toBeInstanceOf(RecoveryRootCauseUnavailableError);
    expect(await recoveryRows()).toHaveLength(0);
  });

  it("uses the unique pending-classification handoff under concurrent calls", async () => {
    const input = request(TENANT_A_REQUEST, RUN_A, INFRA_NODE, {});
    const results = await Promise.all([
      service.classifyFailure(input),
      service.classifyFailure(input),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await recoveryRows()).toHaveLength(1);
  });
});
