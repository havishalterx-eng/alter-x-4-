import { describe, expect, it, vi } from "vitest";
import { EvalServiceClientError, type EvalServiceClient } from "@alterx/adapters";

import { EvalFacadeService } from "./eval-facade.service";

describe("EvalFacadeService", () => {
  it("maps real adapter responses and each sanctioned upstream failure", async () => {
    const client = {
      runEvaluation: vi.fn()
        .mockResolvedValueOnce({ evaluation_run_id: "evr_1", status: "completed", results_json: "{}" })
        .mockRejectedValueOnce(new EvalServiceClientError("invalid_argument"))
        .mockRejectedValueOnce(new EvalServiceClientError("not_found"))
        .mockRejectedValueOnce(new EvalServiceClientError("failed_precondition"))
        .mockRejectedValueOnce(new EvalServiceClientError("deadline_exceeded")),
      checkReleaseGate: vi.fn().mockResolvedValue({ passed: true, failed_thresholds: [] }),
    } as unknown as EvalServiceClient;
    const service = new EvalFacadeService(client);

    await expect(service.runEvaluation({ golden_set_name: "planner" })).resolves.toMatchObject({ evaluation_run_id: "evr_1" });
    await expect(service.checkReleaseGate({ release_gate_key: "engine", evaluation_run_id: "evr_1" })).resolves.toEqual({ passed: true, failed_thresholds: [] });
    await expect(service.runEvaluation({ golden_set_name: "planner" })).rejects.toMatchObject({ response: { status: 400 } });
    await expect(service.runEvaluation({ golden_set_name: "planner" })).rejects.toMatchObject({ response: { status: 404 } });
    await expect(service.runEvaluation({ golden_set_name: "planner" })).rejects.toMatchObject({ response: { status: 409 } });
    await expect(service.runEvaluation({ golden_set_name: "planner" })).rejects.toMatchObject({ response: { status: 504 } });
  });
});
