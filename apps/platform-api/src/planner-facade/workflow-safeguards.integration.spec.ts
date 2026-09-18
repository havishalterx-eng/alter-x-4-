import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditEventHandler } from "@alterx/shared-clients";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeEtag } from "../concurrency";
import type { ActorContext } from "../rbac/types";
import { PlatformDb } from "../signup/platform-db";
import { WorkspaceSafeguardsService } from "../workspaces/workspace-safeguards.service";
import { WorkflowSafeguardsError, WorkflowSafeguardsService } from "./workflow-safeguards.service";

const databaseUrl = process.env.DATABASE_URL ?? "";
const migrationsPath = join(__dirname, "../db/migrations");
const none = { customer_visible: false, contains_pii: false, approve_external_actions: false };

function statements(files: string[]): string[] {
  return files
    .map((file) => readFileSync(join(migrationsPath, file), "utf8"))
    .join("\n--> statement-breakpoint\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe.skipIf(!databaseUrl)("WorkflowSafeguardsService PostgreSQL RLS", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let schemaName: string;
  let roleName: string;
  let recordEvent: ReturnType<typeof vi.fn>;
  let service: WorkflowSafeguardsService;
  let workspaceSafeguards: WorkspaceSafeguardsService;

  beforeEach(async () => {
    schemaName = `workflow_safeguards_${randomUUID().replaceAll("-", "_")}`;
    roleName = `workflow_safeguards_role_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    // The whole chain: 0020's foreign key needs the (tenant_id, id) index 0003 adds.
    for (const statement of statements(readdirSync(migrationsPath).filter((file) => file.endsWith(".sql")).sort())) {
      await admin.query(statement);
    }
    const password = randomUUID();
    await admin.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${roleName}"`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schemaName}" TO "${roleName}"`);
    const url = new URL(databaseUrl);
    url.username = roleName;
    url.password = password;
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    recordEvent = vi.fn().mockResolvedValue({});
    const audit = { recordEvent, getEvent: vi.fn() } as unknown as AuditEventHandler;
    service = new WorkflowSafeguardsService(new PlatformDb(pool), audit);
    workspaceSafeguards = new WorkspaceSafeguardsService(new PlatformDb(pool), audit);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${roleName}"`);
      await admin.end();
    }
  });

  async function editor(): Promise<{ actor: ActorContext; workflowId: string; workspaceId: string }> {
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    await admin.query("INSERT INTO tenants (id, name, status) VALUES ($1, 'Safeguards Tenant', 'active')", [tenantId]);
    await admin.query("INSERT INTO workspaces (id, tenant_id, name, status) VALUES ($1, $2, 'Default', 'active')", [
      workspaceId,
      tenantId,
    ]);
    return {
      actor: {
        user_id: randomUUID(),
        tenant_id: `ten_${tenantId}`,
        workspace_id: `ws_${workspaceId}`,
        roles: ["owner", "editor"],
        permissions: [],
        session_id: "session",
      },
      workflowId: `wf_${uuidv7()}`,
      workspaceId,
    };
  }

  it("starts from the workspace's safeguards with no additions, and plans with them", async () => {
    const { actor, workflowId } = await editor();
    const view = await service.get(actor, workflowId);

    expect(view).toEqual({
      workspace: { contains_pii: true, approve_external_actions: true },
      additions: none,
      effective: { customer_visible: false, contains_pii: true, approve_external_actions: true },
    });
    expect(await service.effectiveFor(actor.tenant_id, actor.workspace_id!, workflowId)).toEqual(view.effective);
  });

  it("keeps additions across plans, and cannot switch off what the workspace requires", async () => {
    const { actor, workflowId } = await editor();
    const view = await service.get(actor, workflowId);

    const saved = await service.set(
      actor,
      workflowId,
      { additions: { customer_visible: true, contains_pii: false, approve_external_actions: false } },
      computeEtag(view),
    );

    expect(saved.effective).toEqual({ customer_visible: true, contains_pii: true, approve_external_actions: true });
    expect(await service.get(actor, workflowId)).toEqual(saved);
    expect(await service.effectiveFor(actor.tenant_id, actor.workspace_id!, workflowId)).toEqual(saved.effective);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workflow.safeguards.update", target_ref: workflowId }),
    );
  });

  it("reaches existing workflows when the workspace turns a safeguard on later", async () => {
    const { actor, workflowId } = await editor();
    const workspaceId = actor.workspace_id!.slice("ws_".length);
    const bareActor = { ...actor, tenant_id: actor.tenant_id.slice("ten_".length) };
    const workspace = await workspaceSafeguards.get(bareActor, workspaceId);
    await workspaceSafeguards.set(
      bareActor,
      workspaceId,
      { safeguards: { contains_pii: false, approve_external_actions: false } },
      computeEtag(workspace),
    );
    const off = await service.get(actor, workflowId);
    await service.set(actor, workflowId, { additions: none }, computeEtag(off));
    expect((await service.get(actor, workflowId)).effective.contains_pii).toBe(false);

    const current = await workspaceSafeguards.get(bareActor, workspaceId);
    await workspaceSafeguards.set(
      bareActor,
      workspaceId,
      { safeguards: { contains_pii: true, approve_external_actions: false } },
      computeEtag(current),
    );

    expect(await service.effectiveFor(actor.tenant_id, actor.workspace_id!, workflowId)).toEqual({
      customer_visible: false,
      contains_pii: true,
      approve_external_actions: false,
    });
  });

  it("rejects the second of two first writers that read the same version", async () => {
    const { actor, workflowId } = await editor();
    const etag = computeEtag(await service.get(actor, workflowId));
    const first = { additions: { ...none, customer_visible: true } };
    const second = { additions: { ...none, contains_pii: true } };

    const results = await Promise.allSettled([
      service.set(actor, workflowId, first, etag),
      service.set(actor, workflowId, second, etag),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 412 } });
  });

  it("rejects a write when the workspace's safeguards changed since the read", async () => {
    const { actor, workflowId } = await editor();
    const etag = computeEtag(await service.get(actor, workflowId));
    const bareActor = { ...actor, tenant_id: actor.tenant_id.slice("ten_".length) };
    const workspaceId = actor.workspace_id!.slice("ws_".length);
    const workspace = await workspaceSafeguards.get(bareActor, workspaceId);
    await workspaceSafeguards.set(
      bareActor,
      workspaceId,
      { safeguards: { contains_pii: false, approve_external_actions: true } },
      computeEtag(workspace),
    );

    await expect(service.set(actor, workflowId, { additions: none }, etag)).rejects.toMatchObject({ status: 412 });
  });

  it("rolls the write back when the audit event is not recorded", async () => {
    const { actor, workflowId } = await editor();
    const etag = computeEtag(await service.get(actor, workflowId));
    recordEvent.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.set(actor, workflowId, { additions: { ...none, customer_visible: true } }, etag),
    ).rejects.toThrow("audit unavailable");

    expect((await service.get(actor, workflowId)).additions).toEqual(none);
  });

  it("isolates tenants, and a workflow's additions from other workspaces", async () => {
    const mine = await editor();
    const theirs = await editor();
    const etag = computeEtag(await service.get(theirs.actor, theirs.workflowId));
    await service.set(theirs.actor, theirs.workflowId, { additions: { ...none, customer_visible: true } }, etag);

    // Another tenant sees nothing of it: a fresh view on its own workspace.
    expect((await service.get(mine.actor, theirs.workflowId)).additions).toEqual(none);

    const otherWorkspace = randomUUID();
    await admin.query("INSERT INTO workspaces (id, tenant_id, name, status) VALUES ($1, $2, 'Other', 'active')", [
      otherWorkspace,
      theirs.actor.tenant_id.slice("ten_".length),
    ]);
    const elsewhere = { ...theirs.actor, workspace_id: `ws_${otherWorkspace}` };
    await expect(service.get(elsewhere, theirs.workflowId)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.effectiveFor(elsewhere.tenant_id, elsewhere.workspace_id, theirs.workflowId),
    ).rejects.toBeInstanceOf(WorkflowSafeguardsError);
  });

  it("refuses a stored shape the API would reject", async () => {
    const { actor, workflowId, workspaceId } = await editor();
    const tenantId = actor.tenant_id.slice("ten_".length);
    for (const additions of [{ customer_visible: true }, { ...none, human_approval_required: true }]) {
      await expect(
        admin.query(
          "INSERT INTO workflow_safeguards (tenant_id, workspace_id, workflow_id, additions) VALUES ($1, $2, $3, $4)",
          [tenantId, workspaceId, workflowId, JSON.stringify(additions)],
        ),
      ).rejects.toThrow(/workflow_safeguards_additions_shape/);
    }
  });
});
