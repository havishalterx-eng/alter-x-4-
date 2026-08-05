import { status } from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";

import { EvalServiceClient, EvalServiceClientError } from "./eval-client";

describe("EvalServiceClient", () => {
  it("calls RunEvaluation with only the current golden_set_name field", async () => {
    const grpc = {
      runEvaluation: vi.fn((_request, options, callback) =>
        callback(null, { evaluation_run_id: "evr_1", status: "completed", results_json: "{}" }),
      ),
    };
    const client = new EvalServiceClient({ address: "localhost:50062", protoPath: "unused" }, grpc as never);

    await expect(client.runEvaluation({ golden_set_name: "planner" })).resolves.toEqual({
      evaluation_run_id: "evr_1", status: "completed", results_json: "{}",
    });
    expect(grpc.runEvaluation).toHaveBeenCalledWith(
      { golden_set_name: "planner" },
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
  });

  it("calls CheckReleaseGate with only its current fields", async () => {
    const grpc = {
      checkReleaseGate: vi.fn((_request, options, callback) =>
        callback(null, { passed: true, failed_thresholds: [] }),
      ),
    };
    const client = new EvalServiceClient({ address: "localhost:50062", protoPath: "unused" }, grpc as never);

    await expect(client.checkReleaseGate({ release_gate_key: "engine", evaluation_run_id: "evr_1" }))
      .resolves.toEqual({ passed: true, failed_thresholds: [] });
    expect(grpc.checkReleaseGate).toHaveBeenCalledWith(
      { release_gate_key: "engine", evaluation_run_id: "evr_1" },
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
  });

  it("maps gRPC errors and empty responses to sanitized adapter errors", async () => {
    const grpc = {
      runEvaluation: vi.fn((_request, _options, callback) => callback({ code: status.NOT_FOUND })),
      checkReleaseGate: vi.fn((_request, _options, callback) => callback(null)),
    };
    const client = new EvalServiceClient({ address: "localhost:50062", protoPath: "unused" }, grpc as never);

    await expect(client.runEvaluation({ golden_set_name: "missing" })).rejects.toMatchObject(
      { code: "not_found" } satisfies Partial<EvalServiceClientError>,
    );
    await expect(client.checkReleaseGate({ release_gate_key: "engine", evaluation_run_id: "evr_1" }))
      .rejects.toMatchObject({ code: "upstream" } satisfies Partial<EvalServiceClientError>);
  });
});
