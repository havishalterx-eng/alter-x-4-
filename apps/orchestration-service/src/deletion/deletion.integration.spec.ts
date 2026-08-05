import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { OrchestrationDeletionService } from "./deletion.service";

const migrationsFolder = resolve(process.cwd(), "apps/orchestration-service/drizzle");
const TENANT_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const TENANT_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b1";
const TENANT_RETENTION = "018f4d6e-2b4a-7a3e-8c1a-1234567890c1";
const MANIFEST = "del_018f4d6e-2b4a-7a3e-8c1a-123456789099";

describe.sequential("OrchestrationDeletionService real Postgres", () => {
  let postgres: StartedPostgreSqlContainer;
  let adminStore: PostgresOrchestrationStoreProvider;
  let tenantStore: PostgresOrchestrationStoreProvider;
  let service: OrchestrationDeletionService;
  const role = `deletion_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");

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
      await tx.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    });
    tenantStore = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: `postgresql://${role}:${password}@${postgres.getHost()}:${postgres.getPort()}/${postgres.getDatabase()}`,
      migrationsFolder,
    });
    service = new OrchestrationDeletionService(tenantStore, adminStore);
  }, 90_000);

  afterAll(async () => {
    await tenantStore?.close();
    await adminStore.withTenant(TENANT_A, async (tx) => {
      await tx.query(`DROP OWNED BY ${role}`);
      await tx.query(`DROP ROLE IF EXISTS ${role}`);
    });
    await adminStore?.close();
    await postgres?.stop();
  }, 60_000);

  it("deletes all 18 tenant tables while preserving a second tenant", async () => {
    await seedAll(adminStore, TENANT_A, "a");
    await seedAll(adminStore, TENANT_B, "b");

    const before = await service.locateSubjectData(`ten_${TENANT_A}`);
    expect(before).toHaveLength(18);
    expect(before.every((location) => location.rowCount === 1)).toBe(true);

    await expect(service.deleteSubjectData(`ten_${TENANT_A}`, MANIFEST)).resolves.toMatchObject({
      deletedRows: 18,
      deletedObjects: 0,
    });
    await expect(service.verifyDeletion(`ten_${TENANT_A}`, MANIFEST)).resolves.toMatchObject({
      deleted: true,
      remaining: [],
    });
    expect((await service.locateSubjectData(`ten_${TENANT_B}`)).every((item) => item.rowCount === 1)).toBe(true);
  });

  it("fails verification while any tenant row survives", async () => {
    await adminStore.withTenant(TENANT_A, async (tx) => {
      await tx.query(
        "INSERT INTO workflows(id,tenant_id,workspace_id,name) VALUES ('wf_partial',$1,$1,'partial')",
        [TENANT_A],
      );
    });
    await expect(service.verifyDeletion(`ten_${TENANT_A}`, MANIFEST)).resolves.toMatchObject({
      deleted: false,
      remaining: [expect.objectContaining({ table: "workflows", rowCount: 1 })],
    });
  });

  it("sweeps expired content only and enumerates subjects without logging them", async () => {
    await seedRetention(adminStore);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const subjects = await service.listSubjectIds();
    expect(subjects).toContain(`ten_${TENANT_RETENTION}`);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    const result = await service.applyRetentionPolicy();
    expect(result.deletedRows).toBeGreaterThanOrEqual(5);
    await tenantStore.withTenant(TENANT_RETENTION, async (tx) => {
      const conversations = await tx.query<{ id: string }>(
        "SELECT id FROM conversations WHERE tenant_id=$1 ORDER BY id",
        [TENANT_RETENTION],
      );
      expect(conversations.rows).toEqual([{ id: "conv_recent" }]);
      const node = await tx.query<{ input_ref: string | null; output_ref: string | null }>(
        "SELECT input_ref,output_ref FROM node_executions WHERE tenant_id=$1 AND id='node_retention'",
        [TENANT_RETENTION],
      );
      expect(node.rows[0]).toEqual({ input_ref: null, output_ref: null });
    });
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

async function seedAll(
  store: PostgresOrchestrationStoreProvider,
  tenant: string,
  suffix: string,
): Promise<void> {
  await store.withTenant(tenant, async (tx) => {
    const workflow = `wf_${suffix}`;
    const workflowVersion = `wfv_${suffix}`;
    const trigger = `trg_${suffix}`;
    const conversation = `conv_${suffix}`;
    const run = `run_${suffix}`;
    const node = `node_${suffix}`;
    await tx.query("INSERT INTO workflows(id,tenant_id,workspace_id,name) VALUES ($1,$2,$2,'fixture')", [workflow, tenant]);
    await tx.query("INSERT INTO workflow_versions(id,tenant_id,workflow_id,version,compiled_dag,dag_schema_version) VALUES ($1,$2,$3,1,'{}','v1')", [workflowVersion, tenant, workflow]);
    await tx.query("INSERT INTO workflow_template_variable_definitions(id,tenant_id,workflow_id,workflow_version_id,name,value_type) VALUES ($1,$2,$3,$4,'REGION','text')", [`wtv_${suffix}`, tenant, workflow, workflowVersion]);
    await tx.query("INSERT INTO workflow_template_variable_values(tenant_id,workflow_id,name,value_json) VALUES ($1,$2,'REGION','\"ap-south-1\"')", [tenant, workflow]);
    await tx.query("INSERT INTO triggers(id,tenant_id,workspace_id,workflow_id,name,type) VALUES ($1,$2,$2,$3,'fixture','manual')", [trigger, tenant, workflow]);
    await tx.query("INSERT INTO trigger_versions(id,tenant_id,trigger_id,version,config) VALUES ($1,$2,$3,1,'{}')", [`trgv_${suffix}`, tenant, trigger]);
    await tx.query("INSERT INTO conversations(id,tenant_id,workspace_id,channel,temporal_workflow_id) VALUES ($1,$2,$2,'api',$3)", [conversation, tenant, `temporal-${suffix}`]);
    await tx.query("INSERT INTO clarifications(id,tenant_id,workspace_id,conversation_id,question,expiry_at) VALUES ($1,$2,$2,$3,'fixture',now()+interval '1 hour')", [`clr_${suffix}`, tenant, conversation]);
    await tx.query("INSERT INTO conversation_goal_states(tenant_id,conversation_id) VALUES ($1,$2)", [tenant, conversation]);
    await tx.query("INSERT INTO events(event_id,event_type,schema_version,tenant_id,workspace_id,source,idempotency_key,occurred_at,conversation_id,trigger_id,trigger_version,payload,signature_status) VALUES ($1,'fixture','v1',$2,$2,'fixture',$3,now(),$4,$5,1,'{}','verified')", [`evt_${suffix}`, tenant, `idem-${suffix}`, conversation, trigger]);
    await tx.query("INSERT INTO runs(id,tenant_id,workspace_id,parent_kind,workflow_id,workflow_version_id,conversation_id,trigger_id) VALUES ($1,$2,$2,'workflow',$3,$4,$5,$6)", [run, tenant, workflow, workflowVersion, conversation, trigger]);
    await tx.query("INSERT INTO blackboard_checkpoints(tenant_id,run_id,context_key,value_json) VALUES ($1,$2,'fixture','{}')", [tenant, run]);
    await tx.query("INSERT INTO node_executions(id,tenant_id,run_id,dag_node_id,node_type,status) VALUES ($1,$2,$3,'fixture','Merge','succeeded')", [node, tenant, run]);
    await tx.query("INSERT INTO run_stream_events(id,tenant_id,run_id,seq,event,payload) VALUES ($1,$2,$3,1,'node.completed','{}')", [`sse_${suffix}`, tenant, run]);
    await tx.query("INSERT INTO verification_results(id,tenant_id,run_id,node_execution_id,gate_type,verdict) VALUES ($1,$2,$3,$4,'quality','pass')", [`vrf_${suffix}`, tenant, run, node]);
    await tx.query("INSERT INTO recovery_actions(id,tenant_id,run_id,node_execution_id,failure_class) VALUES ($1,$2,$3,$4,'fixture')", [`rcv_${suffix}`, tenant, run, node]);
    await tx.query("INSERT INTO run_outcomes(id,tenant_id,workspace_id,run_id,mode,eligible,verdict,human_rescue,critical_external_error,decided_at) VALUES ($1,$2,$2,$3,'workflow',true,'completed_verified',false,false,now())", [`018f4d6e-2b4a-7a3e-8c1a-1234567890${suffix === "a" ? "a8" : "b8"}`, tenant, run]);
    await tx.query("INSERT INTO approvals(id,tenant_id,workspace_id,run_id,node_execution_id,requested_action,expiry_at) VALUES ($1,$2,$2,$3,$4,'{}',now()+interval '1 hour')", [`apr_${suffix}`, tenant, run, node]);
  });
}

async function seedRetention(store: PostgresOrchestrationStoreProvider): Promise<void> {
  await store.withTenant(TENANT_RETENTION, async (tx) => {
    await tx.query("INSERT INTO workflows(id,tenant_id,workspace_id,name) VALUES ('wf_retention',$1,$1,'retention')", [TENANT_RETENTION]);
    await tx.query("INSERT INTO conversations(id,tenant_id,workspace_id,channel,temporal_workflow_id,status,closed_at) VALUES ('conv_old',$1,$1,'api','temporal-old','closed',now()-interval '91 days'),('conv_recent',$1,$1,'api','temporal-recent','closed',now()-interval '89 days')", [TENANT_RETENTION]);
    await tx.query("INSERT INTO conversation_goal_states(tenant_id,conversation_id) VALUES ($1,'conv_old')", [TENANT_RETENTION]);
    await tx.query("INSERT INTO events(event_id,event_type,schema_version,tenant_id,workspace_id,source,idempotency_key,occurred_at,conversation_id,payload,signature_status) VALUES ('evt_old','fixture','v1',$1,$1,'fixture','idem-old',now(),'conv_old','{}','verified')", [TENANT_RETENTION]);
    await tx.query("INSERT INTO runs(id,tenant_id,workspace_id,parent_kind,workflow_id,conversation_id) VALUES ('run_old',$1,$1,'workflow','wf_retention','conv_old'),('run_retention',$1,$1,'workflow','wf_retention',NULL)", [TENANT_RETENTION]);
    await tx.query("INSERT INTO node_executions(id,tenant_id,run_id,dag_node_id,node_type,status,input_ref,output_ref,ended_at) VALUES ('node_retention',$1,'run_retention','fixture','Merge','succeeded','input','output',now()-interval '91 days')", [TENANT_RETENTION]);
  });
}
