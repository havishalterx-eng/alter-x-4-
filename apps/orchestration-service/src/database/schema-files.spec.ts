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
import { verificationResults } from "../../db/schema/verification_results";
import { recoveryActions } from "../../db/schema/recovery_actions";
import { runOutcomes } from "../../db/schema/run_outcomes";
import { approvals } from "../../db/schema/approvals";
import { projects } from "../../db/schema/projects";
import { deployments } from "../../db/schema/deployments";

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
  ["verification_results.ts", "verification_results"],
  ["recovery_actions.ts", "recovery_actions"],
  ["run_outcomes.ts", "run_outcomes"],
  ["approvals.ts", "approvals"],
  ["projects.ts", "projects"],
  ["deployments.ts", "deployments"],
] as const;

describe("orchestration Drizzle schemas", () => {
  it("loads all seventeen executable Drizzle table definitions", () => {
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
      verificationResults,
      recoveryActions,
      runOutcomes,
      approvals,
      projects,
      deployments,
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
      'foreignKey({\n      name: "verification_results_run_tenant_fk"',
      'foreignKey({\n      name: "verification_results_node_execution_tenant_fk"',
      'index("idx_verification_results_tenant_run_created")',
      'foreignKey({\n      name: "recovery_actions_run_tenant_fk"',
      'index("idx_recovery_actions_tenant_run_created")',
      'foreignKey({\n      name: "run_outcomes_run_tenant_fk"',
      'unique("run_outcomes_tenant_run_unique")',
      'index("idx_run_outcomes_tenant_mode_eligible_decided")',
      'foreignKey({\n      name: "approvals_run_tenant_fk"',
      'foreignKey({\n      name: "approvals_node_execution_tenant_fk"',
      'index("idx_approvals_tenant_status_requested")',
      'foreignKey({\n      name: "deployments_project_tenant_fk"',
      'index("idx_deployments_project")',
    ]) {
      expect(allSources).toContain(expected);
    }
  });
});
