import { describe, expect, it, vi } from "vitest";

import {
  PlannerClient,
  PlannerResponseValidationError,
  type PlannerHttpClient,
} from "./planner-client";

function fakeHttpClient(response: unknown): {
  readonly client: PlannerHttpClient;
  readonly calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  return {
    client: {
      async postJson(url, body) {
        calls.push({ url, body });
        return response;
      },
    },
    calls,
  };
}

const CONFIG = { baseUrl: "http://intelligence-service.internal" };
const PROBLEM_SPEC_JSON = JSON.stringify({
  objective: "summarize this doc",
  current_situation: null,
  actors: [],
  systems_involved: [],
  constraints: [],
  required_data: [],
  risk: "unknown",
  missing_information: [],
  success_criteria: [],
  context_references: [],
});

describe("PlannerClient", () => {
  it("posts to /planner/decompose and parses a valid response", async () => {
    const { client, calls } = fakeHttpClient({
      task_skeleton_json: "{}",
      ambiguity_detected: false,
      clarification_questions: [],
    });
    const planner = new PlannerClient(CONFIG, client);

    const result = await planner.decompose({
      tenant_id: "ten_a",
      workspace_id: "ws_a",
      run_id: "run_a",
      problem_spec_json: PROBLEM_SPEC_JSON,
      strategy: "direct",
    });

    expect(result).toEqual({
      task_skeleton_json: "{}",
      ambiguity_detected: false,
      clarification_questions: [],
    });
    expect(calls).toEqual([
      {
        url: "http://intelligence-service.internal/planner/decompose",
        body: {
          tenant_id: "ten_a",
          workspace_id: "ws_a",
          run_id: "run_a",
          problem_spec_json: PROBLEM_SPEC_JSON,
          strategy: "direct",
        },
      },
    ]);
  });

  it("rejects a decompose response missing required fields", async () => {
    const { client } = fakeHttpClient({ ambiguity_detected: false });
    const planner = new PlannerClient(CONFIG, client);

    await expect(
      planner.decompose({
        tenant_id: "ten_a",
        workspace_id: "ws_a",
        run_id: "run_a",
        problem_spec_json: PROBLEM_SPEC_JSON,
        strategy: "direct",
      }),
    ).rejects.toThrow(PlannerResponseValidationError);
  });

  it("posts to Problem Understanding and parses the typed ProblemSpec", async () => {
    const { client, calls } = fakeHttpClient(JSON.parse(PROBLEM_SPEC_JSON));
    const planner = new PlannerClient(CONFIG, client);

    const result = await planner.understand({
      tenant_id: "ten_a",
      workspace_id: "ws_a",
      run_id: "run_a",
      objective: "summarize this doc",
    });

    expect(result.objective).toBe("summarize this doc");
    expect(calls[0]).toEqual({
      url: "http://intelligence-service.internal/internal/problem-understanding/understand",
      body: {
        tenant_id: "ten_a",
        workspace_id: "ws_a",
        run_id: "run_a",
        objective: "summarize this doc",
      },
    });
  });

  it("posts to /planner/select-strategy and parses a valid response", async () => {
    const { client, calls } = fakeHttpClient({
      strategy: "iterative",
      reason: "complex objective",
    });
    const planner = new PlannerClient(CONFIG, client);

    const result = await planner.selectStrategy({
      tenant_id: "ten_a",
      objective: "coordinate multiple steps",
      mode: "workflow",
    });

    expect(result).toEqual({ strategy: "iterative", reason: "complex objective" });
    expect(calls[0]!.url).toBe(
      "http://intelligence-service.internal/planner/select-strategy",
    );
  });

  it("posts to /planner/replan and parses a valid response", async () => {
    const { client } = fakeHttpClient({
      revised_skeleton_json: "{}",
      reason: "node failed",
    });
    const planner = new PlannerClient(CONFIG, client);

    const result = await planner.replan({
      tenant_id: "ten_a",
      run_id: "run_a",
      current_dag_json: "{}",
      failure_context_json: "{}",
    });

    expect(result).toEqual({ revised_skeleton_json: "{}", reason: "node failed" });
  });

  it("propagates an HTTP client failure without swallowing it", async () => {
    const client: PlannerHttpClient = {
      postJson: vi.fn(async () => {
        throw new Error("intelligence-service unreachable");
      }),
    };
    const planner = new PlannerClient(CONFIG, client);

    await expect(
      planner.selectStrategy({ tenant_id: "ten_a", objective: "x", mode: "workflow" }),
    ).rejects.toThrow("intelligence-service unreachable");
  });
});
