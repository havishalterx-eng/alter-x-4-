import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { conversationGoalStates } from "../../db/schema/conversation_goal_states";
import { blackboardCheckpoints } from "../../db/schema/blackboard_checkpoints";
import { conversations } from "../../db/schema/conversations";
import { events } from "../../db/schema/events";
import { runs } from "../../db/schema/runs";
import { nodeExecutions } from "../../db/schema/node_executions";
import { runStreamEvents } from "../../db/schema/run_stream_events";
import { triggerVersions } from "../../db/schema/trigger_versions";
import { triggers } from "../../db/schema/triggers";
import { workflowVersions } from "../../db/schema/workflow_versions";
import { workflows } from "../../db/schema/workflows";

const schemaRoot = resolve(
  process.cwd(),
  "apps/orchestration-service/db/schema",
);

const schemas = [
  ["workflows.ts", "workflows"],
  ["triggers.ts", "triggers"],
  ["trigger_versions.ts", "trigger_versions"],
  ["events.ts", "events"],
  ["conversations.ts", "conversations"],
  ["runs.ts", "runs"],
  ["conversation_goal_states.ts", "conversation_goal_states"],
  ["workflow_versions.ts", "workflow_versions"],
  ["blackboard_checkpoints.ts", "blackboard_checkpoints"],
  ["node_executions.ts", "node_executions"],
  ["run_stream_events.ts", "run_stream_events"],
] as const;

describe("orchestration Drizzle schemas", () => {
  it("loads all eleven executable Drizzle table definitions", () => {
    for (const table of [
      workflows,
      triggers,
      triggerVersions,
      conversations,
      events,
      runs,
      conversationGoalStates,
      workflowVersions,
      blackboardCheckpoints,
      nodeExecutions,
      runStreamEvents,
    ]) {
      expect(table).toBeDefined();
    }
  });

  it.each(schemas)("%s defines %s with tenant ownership", (file, table) => {
    const source = readFileSync(resolve(schemaRoot, file), "utf8");

    expect(source).toContain(`pgTable(\n  "${table}"`);
    expect(source).toContain('uuid("tenant_id").notNull()');
  });

  it("keeps required foreign keys and indexes in schema definitions", () => {
    const allSources = schemas
      .map(([file]) => readFileSync(resolve(schemaRoot, file), "utf8"))
      .join("\n");

    for (const expected of [
      'index("idx_triggers_workflow")',
      'index("idx_trigger_versions_trigger")',
      'uniqueIndex("idx_events_tenant_idempotency")',
      'index("idx_runs_workflow")',
      'foreignKey({\n      name: "triggers_workflow_tenant_fk"',
      'foreignKey({\n      name: "events_trigger_version_tenant_fk"',
      'foreignKey({\n      name: "runs_workflow_tenant_fk"',
      'unique("trigger_versions_tenant_trigger_version_unique")',
      'foreignKey({\n      name: "conversation_goal_states_conversation_tenant_fk"',
      'foreignKey({\n      name: "workflow_versions_workflow_tenant_fk"',
      'index("idx_workflow_versions_workflow")',
      'unique("workflow_versions_tenant_workflow_version_unique")',
      '"workflow_versions_canary_traffic_check"',
      'foreignKey({\n      name: "blackboard_checkpoints_run_tenant_fk"',
      '}).onDelete("cascade")',
      '"blackboard_checkpoints_context_key_check"',
      'foreignKey({\n      name: "node_executions_run_tenant_fk"',
      'index("idx_node_executions_run_dag_node_attempt")',
      'foreignKey({\n      name: "run_stream_events_run_tenant_fk"',
      'index("idx_run_stream_events_tenant_run_seq")',
      'foreignKey({\n      name: "runs_workflow_version_tenant_fk"',
    ]) {
      expect(allSources).toContain(expected);
    }
  });
});
