import { Metadata, status } from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";

import { MemoryServiceClient } from "./memory-client";

const request = {
  tenant_id: "ten_1", workspace_id: "ws_1", run_id: "run_1",
  verified_output_artifact_id: "art_1", namespace: "project-memory",
};

describe("MemoryServiceClient", () => {
  it("calls ProposeWriteback with a deadline", async () => {
    const grpc = { proposeWriteback: vi.fn((_request, _metadata, _options, callback) => callback(null, {
      memory_id: "mem_1", candidate_json: "{}",
    })) };
    const client = new MemoryServiceClient({
      address: "localhost:50060", protoPath: "unused", authorization: "Bearer service-token",
    }, grpc as never);

    await expect(client.proposeWriteback(request)).resolves.toMatchObject({ memory_id: "mem_1" });
    expect(grpc.proposeWriteback).toHaveBeenCalledWith(
      request,
      expect.any(Metadata),
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
    const metadata = grpc.proposeWriteback.mock.calls[0]?.[1] as Metadata;
    expect(metadata.get("authorization")).toEqual(["Bearer service-token"]);
  });

  it("sanitizes gRPC failures", async () => {
    const grpc = { proposeWriteback: vi.fn((_request, _metadata, _options, callback) => callback({ code: status.DEADLINE_EXCEEDED })) };
    const client = new MemoryServiceClient({
      address: "localhost:50060", protoPath: "unused", authorization: "Bearer service-token",
    }, grpc as never);

    await expect(client.proposeWriteback(request)).rejects.toMatchObject({ code: "deadline_exceeded" });
  });
});
