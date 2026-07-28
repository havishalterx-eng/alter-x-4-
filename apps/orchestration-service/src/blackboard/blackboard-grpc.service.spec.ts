import { describe, expect, it, vi } from "vitest";

import { BlackboardGrpcService } from "./blackboard-grpc.service";
import { BlackboardService, BlackboardValidationError } from "./blackboard.service";

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function fakeBlackboard(): BlackboardService {
  return {
    writeValue: vi.fn().mockResolvedValue(undefined),
    readValue: vi.fn().mockResolvedValue(undefined),
  } as unknown as BlackboardService;
}

describe("BlackboardGrpcService.writeValue", () => {
  it("translates the request into a domain writeValue call", async () => {
    const blackboard = fakeBlackboard();
    const service = new BlackboardGrpcService(blackboard);

    await service.writeValue({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      key: "node_a",
      value_json: JSON.stringify({ x: 1 }),
    });

    expect(blackboard.writeValue).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      key: "node_a",
      value: { x: 1 },
    });
  });

  it("rejects malformed value_json", async () => {
    const service = new BlackboardGrpcService(fakeBlackboard());

    await expect(
      service.writeValue({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        key: "node_a",
        value_json: "{not json",
      }),
    ).rejects.toThrow(BlackboardValidationError);
  });
});

describe("BlackboardGrpcService.readValue", () => {
  it("returns found=true with value_json when the key exists", async () => {
    const blackboard = fakeBlackboard();
    vi.mocked(blackboard.readValue).mockResolvedValue({ y: 2 });
    const service = new BlackboardGrpcService(blackboard);

    const response = await service.readValue({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      key: "node_b",
    });

    expect(response).toEqual({ found: true, value_json: JSON.stringify({ y: 2 }) });
  });

  it("returns found=false when the key is absent", async () => {
    const service = new BlackboardGrpcService(fakeBlackboard());

    const response = await service.readValue({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      key: "node_missing",
    });

    expect(response).toEqual({ found: false, value_json: "" });
  });
});
