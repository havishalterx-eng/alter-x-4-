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

  it("real passes an explicit trigger through to the adapter, and omits it when absent", async () => {
    const client = {
      runEvaluation: vi.fn().mockResolvedValue({ evaluation_run_id: "evr_1", status: "completed", results_json: "{}" }),
      checkReleaseGate: vi.fn(),
    } as unknown as EvalServiceClient;
    const service = new EvalFacadeService(client);

    await service.runEvaluation({ golden_set_name: "planner", trigger: "scheduled" });
    expect(client.runEvaluation).toHaveBeenCalledWith({ golden_set_name: "planner", trigger: "scheduled" });

    await service.runEvaluation({ golden_set_name: "planner" });
    expect(client.runEvaluation).toHaveBeenCalledWith({ golden_set_name: "planner" });
  });
});
