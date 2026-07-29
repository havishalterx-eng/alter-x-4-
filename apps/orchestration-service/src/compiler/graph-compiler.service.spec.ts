import { describe, expect, it } from "vitest";

import type { CompilerCompileWorkflowRequest } from "@alterx/contracts";

import {
  CompilerConcurrencyError,
  CompilerValidationError,
  GraphCompilerService,
  type OrchestrationTenantStore,
} from "./graph-compiler.service";

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const WORKFLOW_ID = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

interface WorkflowVersionRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  version: number;
  compiled_dag: string;
  status: string;
}

function createFakeStore(options: { failNextInsertWithCode?: string } = {}): {
  readonly store: OrchestrationTenantStore;
  readonly rows: WorkflowVersionRow[];
} {
  const rows: WorkflowVersionRow[] = [];
  let failNextInsertWithCode = options.failNextInsertWithCode;

  const store: OrchestrationTenantStore = {
    async withTenant(_tenantId, operation) {
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
          values: readonly unknown[] = [],
        ) {
          const sql = statement.replace(/\s+/g, " ").trim();

          if (sql.startsWith("SELECT COALESCE(MAX(version)")) {
            const [tenantId, workflowId] = values as [string, string];
            const existing = rows.filter(
              (r) => r.tenant_id === tenantId && r.workflow_id === workflowId,
            );
            const next = existing.length === 0
              ? 1
              : Math.max(...existing.map((r) => r.version)) + 1;
            return {
              rowCount: 1,
              rows: [{ next_version: next } as unknown as TRow],
            };
          }

          if (sql.startsWith("INSERT INTO workflow_versions")) {
            if (failNextInsertWithCode !== undefined) {
              const code = failNextInsertWithCode;
              failNextInsertWithCode = undefined;
              throw Object.assign(new Error("simulated db error"), { code });
            }
            const [id, tenantId, workflowId, version, compiledDag, , , , ] =
              values as [string, string, string, number, string, string, string, string, string];
            rows.push({
              id,
              tenant_id: tenantId,
              workflow_id: workflowId,
              version,
              compiled_dag: compiledDag,
              status: "compiled",
            });
            return { rowCount: 1, rows: [] };
          }

          throw new Error(`Unhandled fake query: ${sql}`);
        },
      });
    },
  };

  return { store, rows };
}

function skeletonJson(): string {
  return JSON.stringify({
    version: "1",
    entry_point: "node_a",
    nodes: [
      { key: "node_a", type: "llm", config: {}, depends_on: [] },
      { key: "node_b", type: "tool", config: {}, depends_on: ["node_a"] },
    ],
  });
}

function compileRequest(
  overrides: Partial<CompilerCompileWorkflowRequest> = {},
): CompilerCompileWorkflowRequest {
  return {
    tenant_id: TENANT_ID,
    workflow_id: WORKFLOW_ID,
    task_skeleton_json: skeletonJson(),
    dag_schema_version: "v1",
    ...overrides,
  };
}

describe("GraphCompilerService.compileWorkflow", () => {
  it("persists a workflow_versions row with a bare-UUID tenant_id", async () => {
    const { store, rows } = createFakeStore();
    const service = new GraphCompilerService(store);

    await service.compileWorkflow(compileRequest());

    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id).toBe(TENANT_ID.slice("ten_".length));
    expect(rows[0]!.workflow_id).toBe(WORKFLOW_ID);
    expect(rows[0]!.version).toBe(1);
  });

  it("returns a wfv_ prefixed workflow_version_id", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);

    const response = await service.compileWorkflow(compileRequest());

    expect(response.workflow_version_id).toMatch(
      /^wfv_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns compiled_dag_json that round-trips as a valid CompiledDag", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);

    const response = await service.compileWorkflow(compileRequest());
    const dag = JSON.parse(response.compiled_dag_json);

    expect(dag.entry_node_keys).toEqual(["node_a"]);
    expect(dag.nodes).toHaveLength(3);
  });

  it("increments version on a second compile of the same workflow", async () => {
    const { store, rows } = createFakeStore();
    const service = new GraphCompilerService(store);

    await service.compileWorkflow(compileRequest());
    await service.compileWorkflow(compileRequest());

    expect(rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it("rejects a malformed tenant_id", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);

    await expect(
      service.compileWorkflow(compileRequest({ tenant_id: "not-a-tenant" })),
    ).rejects.toThrow(CompilerValidationError);
  });

  it("rejects a malformed workflow_id", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);

    await expect(
      service.compileWorkflow(compileRequest({ workflow_id: "not-a-workflow" })),
    ).rejects.toThrow(CompilerValidationError);
  });

  it("rejects blank task_skeleton_json", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);

    await expect(
      service.compileWorkflow(compileRequest({ task_skeleton_json: "   " })),
    ).rejects.toThrow(CompilerValidationError);
  });

  it("maps a unique-violation insert into CompilerConcurrencyError", async () => {
    const { store } = createFakeStore({ failNextInsertWithCode: "23505" });
    const service = new GraphCompilerService(store);

    await expect(service.compileWorkflow(compileRequest())).rejects.toThrow(
      CompilerConcurrencyError,
    );
  });

  it("maps a foreign-key-violation insert into CompilerValidationError", async () => {
    const { store } = createFakeStore({ failNextInsertWithCode: "23503" });
    const service = new GraphCompilerService(store);

    await expect(service.compileWorkflow(compileRequest())).rejects.toThrow(
      CompilerValidationError,
    );
  });

  it("returns empty node_requirements_json and policy_bindings_json records", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);

    const response = await service.compileWorkflow(compileRequest());

    expect(JSON.parse(response.node_requirements_json)).toEqual({});
    expect(JSON.parse(response.policy_bindings_json)).toEqual({});
  });
});

describe("GraphCompilerService.validateWorkflowDag", () => {
  it("reports valid=true for a well-formed CompiledDag", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);
    const compileResponse = await service.compileWorkflow(compileRequest());

    const result = await service.validateWorkflowDag({
      tenant_id: TENANT_ID,
      workflow_id: WORKFLOW_ID,
      workflow_dag_json: compileResponse.compiled_dag_json,
    });

    expect(result).toEqual({ valid: true, issues_json: [] });
  });

  it("reports valid=false with issues for malformed JSON", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);

    const result = await service.validateWorkflowDag({
      tenant_id: TENANT_ID,
      workflow_id: WORKFLOW_ID,
      workflow_dag_json: "{not json",
    });

    expect(result.valid).toBe(false);
    expect(result.issues_json.length).toBeGreaterThan(0);
  });

  it("reports valid=false with schema issues for a structurally wrong DAG", async () => {
    const { store } = createFakeStore();
    const service = new GraphCompilerService(store);

    const result = await service.validateWorkflowDag({
      tenant_id: TENANT_ID,
      workflow_id: WORKFLOW_ID,
      workflow_dag_json: JSON.stringify({ nodes: [] }),
    });

    expect(result.valid).toBe(false);
    expect(result.issues_json.length).toBeGreaterThan(0);
  });
});
