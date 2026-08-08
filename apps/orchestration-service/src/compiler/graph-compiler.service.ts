import { createHash, randomUUID } from "node:crypto";

import type {
  CompilerCompileWorkflowRequest,
  CompilerCompileWorkflowResponse,
  CompilerValidateWorkflowDagRequest,
  CompilerValidateWorkflowDagResponse,
} from "@alterx/contracts";
import { CompiledDagSchema, NodeRequirementsSchema, type NodeRequirements } from "@alterx/contracts";
import type { CapabilityServiceHandlerClient } from "@alterx/adapters";

import {
  CompilerValidationError,
  compileTaskSkeletonToDag,
  parseTaskSkeleton,
} from "./dag-builder";

export { CompilerValidationError } from "./dag-builder";

export class CompilerConcurrencyError extends Error {
  constructor(workflowId: string) {
    super(`workflow_versions insert raced for workflow_id=${workflowId}; retry the compile`);
    this.name = "CompilerConcurrencyError";
  }
}

const COMPILER_VERSION = "compiler-core-v1";
const TENANT_ID_PATTERN =
  /^ten_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_ID_PATTERN =
  /^wf_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

interface OrchestrationTransactionLike {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

export interface OrchestrationTenantStore {
  withTenant<T>(
    tenantId: string,
    operation: (tx: OrchestrationTransactionLike) => Promise<T>,
  ): Promise<T>;
}

function bareTenantUuid(tenantId: string): string {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new CompilerValidationError("tenant_id must be a ten_ prefixed UUIDv7");
  }
  return tenantId.slice("ten_".length);
}

function requireValidWorkflowId(workflowId: string): void {
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new CompilerValidationError("workflow_id must be a wf_ prefixed UUIDv7");
  }
}

function prefixedUuidV7(prefix: string): string {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}

export class GraphCompilerService {
  constructor(
    private readonly store: OrchestrationTenantStore,
    private readonly capabilityService: CapabilityServiceHandlerClient,
  ) {}

  async compileWorkflow(
    request: CompilerCompileWorkflowRequest,
  ): Promise<CompilerCompileWorkflowResponse> {
    if (request.task_skeleton_json.trim().length === 0) {
      throw new CompilerValidationError("task_skeleton_json is required");
    }
    if (request.dag_schema_version.trim().length === 0) {
      throw new CompilerValidationError("dag_schema_version is required");
    }
    requireValidWorkflowId(request.workflow_id);
    const bareTenant = bareTenantUuid(request.tenant_id);

    const skeleton = parseTaskSkeleton(request.task_skeleton_json);
    const compiledDag = compileTaskSkeletonToDag(skeleton, request.dag_schema_version);

    const compileMetadata = {
      compiler_version: COMPILER_VERSION,
      source_skeleton_hash: createHash("sha256")
        .update(request.task_skeleton_json)
        .digest("hex"),
      compiled_at: new Date().toISOString(),
    };
    const nodeRequirements = await this.#resolveNodeRequirements(
      request.tenant_id,
      compiledDag.nodes,
    );
    const policyBindings = {};

    const workflowVersionId = prefixedUuidV7("wfv");

    await this.store.withTenant(bareTenant, async (tx) => {
      const nextVersionResult = await tx.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM workflow_versions
         WHERE tenant_id = $1 AND workflow_id = $2`,
        [bareTenant, request.workflow_id],
      );
      const nextVersion = nextVersionResult.rows[0]?.next_version ?? 1;

      try {
        await tx.query(
          `INSERT INTO workflow_versions
             (id, tenant_id, workflow_id, version, compiled_dag, dag_schema_version,
              node_requirements, policy_bindings, compile_metadata, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'compiled')`,
          [
            workflowVersionId,
            bareTenant,
            request.workflow_id,
            nextVersion,
            JSON.stringify(compiledDag),
            request.dag_schema_version,
            JSON.stringify(nodeRequirements),
            JSON.stringify(policyBindings),
            JSON.stringify(compileMetadata),
          ],
        );
      } catch (error: unknown) {
        const code = (error as { code?: string }).code;
        if (code === UNIQUE_VIOLATION) {
          throw new CompilerConcurrencyError(request.workflow_id);
        }
        if (code === FOREIGN_KEY_VIOLATION) {
          throw new CompilerValidationError(
            `workflow_id "${request.workflow_id}" does not reference an existing workflow`,
          );
        }
        throw error;
      }

      return nextVersion;
    });

    return {
      workflow_version_id: workflowVersionId,
      compiled_dag_json: JSON.stringify(compiledDag),
      node_requirements_json: JSON.stringify(nodeRequirements),
      policy_bindings_json: JSON.stringify(policyBindings),
    };
  }

  async #resolveNodeRequirements(
    tenantId: string,
    nodes: readonly { readonly key: string; readonly type: string; readonly config: Record<string, unknown> }[],
  ): Promise<NodeRequirements> {
    const entries = await Promise.all(nodes.map(async (node) => {
      const response = await this.capabilityService.resolveNodeRequirements({
        tenant_id: tenantId,
        // Compilation happens before a run exists; the resolver does not use this field.
        run_id: "",
        node_key: node.key,
        node_type: node.type,
        node_config_json: JSON.stringify(node.config),
      });
      try {
        return [node.key, JSON.parse(response.node_requirements_json)] as const;
      } catch {
        throw new CompilerValidationError(
          `Capability Service returned invalid requirements for node ${node.key}`,
        );
      }
    }));
    const parsed = NodeRequirementsSchema.safeParse(Object.fromEntries(entries));
    if (!parsed.success) {
      throw new CompilerValidationError(
        `Capability Service returned invalid requirements: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  async validateWorkflowDag(
    request: CompilerValidateWorkflowDagRequest,
  ): Promise<CompilerValidateWorkflowDagResponse> {
    let raw: unknown;
    try {
      raw = JSON.parse(request.workflow_dag_json);
    } catch (error: unknown) {
      return { valid: false, issues_json: [JSON.stringify({ message: (error as Error).message })] };
    }

    const result = CompiledDagSchema.safeParse(raw);
    if (result.success) {
      return { valid: true, issues_json: [] };
    }
    return {
      valid: false,
      issues_json: result.error.issues.map((issue) =>
        JSON.stringify({ path: issue.path, message: issue.message, code: issue.code }),
      ),
    };
  }
}
