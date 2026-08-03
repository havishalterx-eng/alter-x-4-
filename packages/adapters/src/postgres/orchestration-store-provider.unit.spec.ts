import type { Pool, PoolClient, PoolConfig } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  POSTGRES_ORCHESTRATION_FEATURE_DECISION,
  PostgresOrchestrationStoreProvider,
} from "./orchestration-store-provider";

const migrationsFolder = "apps/orchestration-service/drizzle";
const tenantId = "00000000-0000-7000-8000-000000000001";

function poolWithClient(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ "?column?": 1 }] }),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pool;
}

function clientWithQuery(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
): PoolClient {
  return {
    query: vi.fn(query),
    release: vi.fn(),
  } as unknown as PoolClient;
}

describe("PostgresOrchestrationStoreProvider", () => {
  it("validates static and IAM configuration", async () => {
    expect(
      () =>
        new PostgresOrchestrationStoreProvider({
          authentication: "static",
          connectionString: "",
          migrationsFolder,
        }),
    ).toThrow(/connectionString/);
    expect(
      () =>
        new PostgresOrchestrationStoreProvider({
          authentication: "static",
          connectionString: "postgresql://test.invalid/orchestration",
          migrationsFolder: "",
        }),
    ).toThrow(/migrationsFolder/);

    for (const [field, override] of [
      ["host", { host: "" }],
      ["database", { database: "" }],
      ["user", { user: "" }],
      ["region", { region: "" }],
      ["port", { port: 0 }],
      ["port", { port: 5432.5 }],
      ["port", { port: 65_536 }],
    ] as const) {
      const config = Object.assign(
        {
          authentication: "iam" as const,
          host: "db.example.com",
          port: 5432,
          database: "orchestration_db",
          user: "orchestration_service",
          region: "ap-south-1",
          migrationsFolder,
        },
        override,
      );
      expect(
        () =>
          new PostgresOrchestrationStoreProvider(
            config,
            { poolFactory: () => ({}) as Pool },
          ),
      ).toThrow(field);
    }

    const getAuthToken = vi.fn().mockResolvedValue("iam-token");
    let poolConfig: PoolConfig | undefined;
    const provider = new PostgresOrchestrationStoreProvider(
      {
        authentication: "iam",
        host: "db.example.com",
        port: 5432,
        database: "orchestration_db",
        user: "orchestration_service",
        region: "ap-south-1",
        migrationsFolder,
      },
      {
        iamAuthTokenProvider: { getAuthToken },
        poolFactory: (config) => {
          poolConfig = config;
          return { end: vi.fn().mockResolvedValue(undefined) } as unknown as Pool;
        },
      },
    );

    expect(poolConfig).toMatchObject({
      host: "db.example.com",
      port: 5432,
      database: "orchestration_db",
      user: "orchestration_service",
      ssl: { rejectUnauthorized: true },
    });
    const password = poolConfig?.password;
    if (typeof password !== "function") {
      throw new Error("Expected async password callback");
    }
    await expect(password()).resolves.toBe("iam-token");
    await provider.close();

    let signerPoolConfig: PoolConfig | undefined;
    const signerProvider = new PostgresOrchestrationStoreProvider(
      {
        authentication: "iam",
        host: "db.example.com",
        port: 5432,
        database: "orchestration_db",
        user: "orchestration_service",
        region: "ap-south-1",
        migrationsFolder,
      },
      {
        poolFactory: (config) => {
          signerPoolConfig = config;
          return { end: vi.fn().mockResolvedValue(undefined) } as unknown as Pool;
        },
      },
    );
    expect(signerPoolConfig?.password).toBeTypeOf("function");
    await signerProvider.close();

    const defaultPoolProvider = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: "postgresql://127.0.0.1:1/orchestration",
      migrationsFolder,
    });
    await defaultPoolProvider.close();
  });

  it("records the CEO-approved ungated INGR-1 foundation decision", async () => {
    const provider = new PostgresOrchestrationStoreProvider(
      {
        authentication: "static",
        connectionString: "postgresql://test.invalid/orchestration",
        migrationsFolder,
      },
      {
        pool: {
          end: vi.fn().mockResolvedValue(undefined),
        } as unknown as Pool,
      },
    );

    expect(provider.metadata.featureFlag).toBeUndefined();
    expect(POSTGRES_ORCHESTRATION_FEATURE_DECISION).toEqual({
      ticket: "INGR-1",
      component: "Engine component 31 - Event & Trigger Gateway",
      status: "approved_ungated_foundation_schema",
      featureId: null,
      featureFlag: null,
      reason:
        "schema/contracts/migrations foundation only; no user-facing rollout behavior",
      owner: "CEO",
      decisionDate: "2026-07-25",
      rollout:
        "merge allowed after CI/audit green; no runtime feature gate required",
    });
    await provider.close();
  });

  it("runs tenant operations in a transaction and commits", async () => {
    const client = clientWithQuery(async () => ({ rowCount: 1, rows: [] }));
    const provider = new PostgresOrchestrationStoreProvider(
      {
        authentication: "static",
        connectionString: "postgresql://test.invalid/orchestration",
        migrationsFolder,
      },
      { pool: poolWithClient(client) },
    );

    await expect(
      provider.withTenant(tenantId, async (transaction) => {
        await expect(
          transaction.query("SELECT $1::text AS value", ["value"]),
        ).resolves.toEqual({ rowCount: 1, rows: [] });
        return "done";
      }),
    ).resolves.toBe("done");
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      "SELECT $1::text AS value",
      ["value"],
    );
    expect(client.query).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back failed tenant operations without hiding original error", async () => {
    const failure = new Error("operation failed");
    const client = clientWithQuery(async () => ({ rowCount: 1, rows: [] }));
    const provider = new PostgresOrchestrationStoreProvider(
      {
        authentication: "static",
        connectionString: "postgresql://test.invalid/orchestration",
        migrationsFolder,
      },
      { pool: poolWithClient(client) },
    );

    await expect(
      provider.withTenant(tenantId, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects invalid tenant IDs before opening a connection", async () => {
    const connect = vi.fn();
    const provider = new PostgresOrchestrationStoreProvider(
      {
        authentication: "static",
        connectionString: "postgresql://test.invalid/orchestration",
        migrationsFolder,
      },
      {
        pool: {
          connect,
          end: vi.fn().mockResolvedValue(undefined),
        } as unknown as Pool,
      },
    );

    await expect(
      provider.withTenant("ten_not-a-uuid", async () => undefined),
    ).rejects.toThrow("tenantId must be a UUID");
    expect(connect).not.toHaveBeenCalled();
  });

  it("reports healthy and unhealthy database state", async () => {
    const healthyPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;
    const healthy = new PostgresOrchestrationStoreProvider(
      {
        authentication: "static",
        connectionString: "postgresql://test.invalid/orchestration",
        migrationsFolder,
      },
      { pool: healthyPool },
    );
    await expect(healthy.healthCheck()).resolves.toMatchObject({
      status: "healthy",
    });
    expect(healthy.metadata.interfaceName).toBe("RelationalDatabaseProvider");

    const unhealthyPool = {
      query: vi.fn().mockRejectedValue(new Error("offline")),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;
    const unhealthy = new PostgresOrchestrationStoreProvider(
      {
        authentication: "static",
        connectionString: "postgresql://test.invalid/orchestration",
        migrationsFolder,
      },
      { pool: unhealthyPool },
    );
    await expect(unhealthy.healthCheck()).resolves.toMatchObject({
      status: "unhealthy",
    });

    await healthy.close();
    await unhealthy.close();
    expect(healthyPool.end).toHaveBeenCalledOnce();
    expect(unhealthyPool.end).toHaveBeenCalledOnce();
  });

  it("executes rollback files in reverse order", async () => {
    const client = clientWithQuery(async () => ({ rowCount: 0, rows: [] }));
    const provider = new PostgresOrchestrationStoreProvider(
      {
        authentication: "static",
        connectionString: "postgresql://test.invalid/orchestration",
        migrationsFolder,
      },
      { pool: poolWithClient(client) },
    );

    await provider.rollback();
    const statements = vi
      .mocked(client.query)
      .mock.calls.map(([statement]) => String(statement));
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain('DROP TABLE IF EXISTS "deployments"');
    expect(statements[1]).toContain('DROP TABLE IF EXISTS "projects"');
    expect(statements[2]).toContain('DROP CONSTRAINT "node_executions_status_check"');
    expect(statements[3]).toContain('DROP INDEX IF EXISTS "idx_recovery_actions_pending_node"');
    expect(statements[4]).toContain('DROP TABLE IF EXISTS "approvals"');
    expect(statements[5]).toContain('DROP TABLE IF EXISTS "run_outcomes"');
    expect(statements[6]).toContain('DROP TABLE IF EXISTS "recovery_actions"');
    expect(statements[7]).toContain('DROP TABLE IF EXISTS "verification_results"');
    expect(statements[8]).toContain('DROP CONSTRAINT IF EXISTS "runs_workflow_version_tenant_fk"');
    expect(statements[8]).toContain('DROP COLUMN IF EXISTS "workflow_version_id"');
    expect(statements[9]).toContain('DROP TABLE IF EXISTS "run_stream_events"');
    expect(statements[10]).toContain('DROP TABLE IF EXISTS "node_executions"');
    expect(statements[11]).toContain('DROP TABLE IF EXISTS "blackboard_checkpoints"');
    expect(statements[12]).toContain("workflow_versions_canary_traffic_check");
    expect(statements[13]).toContain("workflow_versions_reject_tenant_id_change");
    expect(statements[14]).toContain("conversation_goal_states_reject_tenant_id_change");
    expect(statements[15]).toContain("runs_reject_tenant_id_change");
    expect(statements[20]).toContain("workflows_reject_tenant_id_change");
    expect(statements[21]).toBe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    expect(statements[22]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("preserves rollback failure and releases the connection", async () => {
    const failure = new Error("rollback file failed");
    const client = clientWithQuery(async (statement) => {
      if (statement.includes("runs_reject_tenant_id_change")) {
        throw failure;
      }
      if (statement === "ROLLBACK") {
        throw new Error("rollback transaction failed");
      }
      return { rowCount: 0, rows: [] };
    });
    const provider = new PostgresOrchestrationStoreProvider(
      {
        authentication: "static",
        connectionString: "postgresql://test.invalid/orchestration",
        migrationsFolder,
      },
      { pool: poolWithClient(client) },
    );

    await expect(provider.rollback()).rejects.toBe(failure);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
