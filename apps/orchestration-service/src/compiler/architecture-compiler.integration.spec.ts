import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ArchitectureCompileInput } from "./architecture-dag-builder";
import { GraphCompilerService } from "./graph-compiler.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_TENANT = TENANT.slice(4);
const WORKSPACE = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const WORKFLOW = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const migrationsFolder = resolve(process.cwd(), "apps/orchestration-service/drizzle");

function request(): ArchitectureCompileInput {
  return {
    tenant_id: TENANT, workspace_id: WORKSPACE, workflow_id: WORKFLOW, dag_schema_version: "v1",
    architecture: { status: "ready", version: "1", topology: "single", boundaries: [{ kind: "verification", after_node_key: "work", reason: "required" }], nodes: [{ source_node_key: "work", role: "direct", execution_kind: "llm", depends_on: [], capability_role: { source_node_key: "work", required_capabilities: ["text"], eligible_kinds: ["model"] } }], execution_waves: [{ order: 0, node_keys: ["work"], depends_on_wave_orders: [] }] },
    binding_decision: { status: "ready", bindings: [{ record_id: "model-pinned", version: 7, kind: "model", source_node_key: "work", rationale: "approved", score: 1, factors: { reliability: 1 } }] },
  };
}

describe.sequential("architecture graph compiler Postgres integration", () => {
  let postgres: StartedPostgreSqlContainer;
  let store: PostgresOrchestrationStoreProvider;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:16.6-alpine").withDatabase("compiler").withUsername("compiler").withPassword(randomUUID()).start();
    store = new PostgresOrchestrationStoreProvider({ authentication: "static", connectionString: postgres.getConnectionUri(), migrationsFolder });
    await store.migrate();
    await store.withTenant(BARE_TENANT, (tx) => tx.query("INSERT INTO workflows(id,tenant_id,workspace_id,name) VALUES ($1,$2,$3,'architecture')", [WORKFLOW, BARE_TENANT, WORKSPACE.slice(3)]));
  }, 60_000);
  afterAll(async () => { await store?.close(); await postgres?.stop(); }, 30_000);

  it("persists a valid pinned DAG under its tenant", async () => {
    const compiler = new GraphCompilerService(store, {} as never);
    const input = request();
    const result = await compiler.compileArchitectureWorkflow({ ...input, architecture_json: JSON.stringify(input.architecture), binding_decision_json: JSON.stringify(input.binding_decision) });
    const dag = JSON.parse(result.compiled_dag_json);
    expect(dag.nodes.find((node: { key: string }) => node.key === "work").config).toMatchObject({ capability_record_id: "model-pinned", capability_version: 7 });
    await expect(store.withTenant(BARE_TENANT, (tx) => tx.query("SELECT id FROM workflow_versions WHERE id = $1", [result.workflow_version_id]))).resolves.toMatchObject({ rowCount: 1 });
  });

  it("rejects a workflow compiled under another workspace", async () => {
    const compiler = new GraphCompilerService(store, {} as never);
    const input = request();
    await expect(compiler.compileArchitectureWorkflow({ ...input, workspace_id: "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ac", architecture_json: JSON.stringify(input.architecture), binding_decision_json: JSON.stringify(input.binding_decision) })).rejects.toThrow("workflow is not visible");
  });
});
