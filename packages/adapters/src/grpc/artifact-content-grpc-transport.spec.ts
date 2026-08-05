import { describe, expect, it, vi } from "vitest";
import { ArtifactContentGrpcController } from "./artifact-content-grpc-transport";

const request = { tenant_id: "ten_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa", run_id: "run_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa", content_type: "text/plain", content: new Uint8Array([1]) };

describe("ArtifactContentGrpcController", () => {
  it("delegates create and preserves its generated response shape", async () => {
    const handler = { createContent: vi.fn(async () => ({ artifact_id: "art_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa", size_bytes: 1 })), readContent: vi.fn() };
    const controller = new ArtifactContentGrpcController(handler);
    await expect(controller.createContent(request)).resolves.toEqual({ artifact_id: "art_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa", size_bytes: 1 });
    expect(handler.createContent).toHaveBeenCalledWith(request);
  });
});
