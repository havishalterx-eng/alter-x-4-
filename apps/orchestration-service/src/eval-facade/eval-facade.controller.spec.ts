import { createHash } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { EvalFacadeController } from "./eval-facade.controller";
import type { EvalFacadeService } from "./eval-facade.service";

const TOKEN = "eval-internal-token";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");

describe("EvalFacadeController", () => {
  it("relays both current request shapes only after internal authentication", async () => {
    const service = {
      runEvaluation: vi.fn().mockResolvedValue({ evaluation_run_id: "evr_1", status: "completed", results_json: "{}" }),
      checkReleaseGate: vi.fn().mockResolvedValue({ passed: true, failed_thresholds: [] }),
    } as unknown as EvalFacadeService;
    const controller = new EvalFacadeController(service, TOKEN_HASH);

    await expect(controller.runEvaluation({ golden_set_name: "planner" }, `Bearer ${TOKEN}`))
      .resolves.toMatchObject({ evaluation_run_id: "evr_1" });
    await expect(controller.checkReleaseGate({ release_gate_key: "engine", evaluation_run_id: "evr_1" }, `Bearer ${TOKEN}`))
      .resolves.toEqual({ passed: true, failed_thresholds: [] });
    expect(service.runEvaluation).toHaveBeenCalledWith({ golden_set_name: "planner" });
    expect(service.checkReleaseGate).toHaveBeenCalledWith({ release_gate_key: "engine", evaluation_run_id: "evr_1" });
  });

  it("rejects invalid credentials and request bodies before invoking the facade", () => {
    const service = { runEvaluation: vi.fn(), checkReleaseGate: vi.fn() } as unknown as EvalFacadeService;
    const controller = new EvalFacadeController(service, TOKEN_HASH);

    for (const authorization of [undefined, "Bearer wrong"]) {
      expect(() => controller.runEvaluation({ golden_set_name: "planner" }, authorization))
        .toThrow(HttpException);
    }
    expect(() => controller.runEvaluation({}, `Bearer ${TOKEN}`)).toThrow(HttpException);
    expect(() => controller.checkReleaseGate({ release_gate_key: "engine" }, `Bearer ${TOKEN}`)).toThrow(HttpException);
    expect(service.runEvaluation).not.toHaveBeenCalled();
    expect(service.checkReleaseGate).not.toHaveBeenCalled();
  });
});
