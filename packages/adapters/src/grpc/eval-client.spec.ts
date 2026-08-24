import { status } from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";

import { EvalServiceClient, EvalServiceClientError } from "./eval-client";

describe("EvalServiceClient", () => {
  it("calls RunEvaluation with a real empty trigger when the caller omits one", async () => {
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
      { golden_set_name: "planner", trigger: "" },
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
  });

  it("calls RunEvaluation with a real caller-supplied trigger", async () => {
    const grpc = {
      runEvaluation: vi.fn((_request, options, callback) =>
        callback(null, { evaluation_run_id: "evr_1", status: "completed", results_json: "{}" }),
      ),
    };
    const client = new EvalServiceClient({ address: "localhost:50062", protoPath: "unused" }, grpc as never);

    await client.runEvaluation({ golden_set_name: "planner", trigger: "scheduled" });
    expect(grpc.runEvaluation).toHaveBeenCalledWith(
      { golden_set_name: "planner", trigger: "scheduled" },
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

  // ENGINE-FIX-P5-SEC-1: eval-service's gRPC interceptor requires the
  // internal service credential on every RPC.
  it("sends the configured internal service credential as authorization metadata", async () => {
    const grpc = {
      runEvaluation: vi.fn((_request, _options, callback) =>
        callback(null, { evaluation_run_id: "evr_1", status: "completed", results_json: "{}" }),
      ),
    };
    const client = new EvalServiceClient(
      { address: "localhost:50062", protoPath: "unused", authorization: "Bearer service-token" },
      grpc as never,
    );

    await client.runEvaluation({ golden_set_name: "planner" });
    const options = (grpc.runEvaluation as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(options.metadata.get("authorization")).toEqual(["Bearer service-token"]);
  });
});
