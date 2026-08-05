import { describe, expect, it, vi } from "vitest";
import {
  TemplateVariablesService,
  type OrchestrationTenantStore,
} from "./template-variables.service";

const TENANT = "ten_00000000-0000-7000-8000-00000000000a";
const BARE_TENANT = "00000000-0000-7000-8000-00000000000a";
const WORKFLOW = "wf_00000000-0000-7000-8000-00000000000b";

function fakeStore(rows: () => readonly Record<string, unknown>[]): {
  readonly store: OrchestrationTenantStore;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (statement: string) => {
    if (statement.includes("FROM workflow_template_variable_definitions")) {
      return { rowCount: rows().length, rows: rows() };
    }
    if (statement.startsWith("SELECT id, version FROM workflow_versions")) {
      return { rowCount: 1, rows: [{ id: "wfv_current", version: 3 }] };
    }
    return { rowCount: 1, rows: [] };
  });
  return {
    store: { async withTenant(tenantId, operation) { expect(tenantId).toBe(BARE_TENANT); return operation({ query: query as never }); } },
    query,
  };
}

describe("TemplateVariablesService", () => {
  it("never returns a secret value", async () => {
    const { store } = fakeStore(() => [{
      name: "API_TOKEN",
      value_type: "secret",
      required: true,
      workflow_version_id: "wfv_current",
      workflow_version: 3,
      is_set: true,
      value_json: "do-not-return",
    }]);

    await expect(new TemplateVariablesService(store).list(TENANT, WORKFLOW)).resolves.toEqual([
      {
        name: "API_TOKEN",
        value_type: "secret",
        required: true,
        workflow_version_id: "wfv_current",
        workflow_version: 3,
        is_set: true,
        masked: true,
      },
    ]);
  });

  it("changes runtime values without writing a workflow version", async () => {
    let isSet = false;
    const { store, query } = fakeStore(() => [{
      name: "REGION",
      value_type: "text",
      required: false,
      workflow_version_id: "wfv_current",
      workflow_version: 3,
      is_set: isSet,
      value_json: isSet ? "ap-south-1" : null,
    }]);
    query.mockImplementation(async (statement: string) => {
      if (statement.includes("FROM workflow_template_variable_definitions")) {
        const result = [{
          name: "REGION", value_type: "text", required: false,
          workflow_version_id: "wfv_current", workflow_version: 3,
          is_set: isSet, value_json: isSet ? "ap-south-1" : null,
        }];
        return { rowCount: 1, rows: result };
      }
      if (statement.startsWith("INSERT INTO workflow_template_variable_values")) isSet = true;
      return { rowCount: 1, rows: [] };
    });

    await expect(
      new TemplateVariablesService(store).setValue(TENANT, WORKFLOW, "REGION", "ap-south-1"),
    ).resolves.toMatchObject({ value: "ap-south-1", is_set: true });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO workflow_versions"), expect.anything());
  });

  it("creates a new workflow version when definitions change", async () => {
    let replaced = false;
    const { store, query } = fakeStore(() => replaced ? [{
      name: "RETRIES", value_type: "number", required: false,
      workflow_version_id: "wfv_next", workflow_version: 4, is_set: false, value_json: null,
    }] : []);
    query.mockImplementation(async (statement: string) => {
      if (statement.includes("FROM workflow_template_variable_definitions")) {
        return { rowCount: replaced ? 1 : 0, rows: replaced ? [{
          name: "RETRIES", value_type: "number", required: false,
          workflow_version_id: "wfv_next", workflow_version: 4, is_set: false, value_json: null,
        }] : [] };
      }
      if (statement.startsWith("SELECT id, version FROM workflow_versions")) {
        return { rowCount: 1, rows: [{ id: "wfv_current", version: 3 }] };
      }
      if (statement.startsWith("INSERT INTO workflow_template_variable_definitions")) replaced = true;
      return { rowCount: 1, rows: [] };
    });

    await expect(
      new TemplateVariablesService(store).replaceDefinitions(TENANT, WORKFLOW, [
        { name: "RETRIES", value_type: "number", required: false },
      ]),
    ).resolves.toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO workflow_versions"), expect.any(Array));
  });
});
