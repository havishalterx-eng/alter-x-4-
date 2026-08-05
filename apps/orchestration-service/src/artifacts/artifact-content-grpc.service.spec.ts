import { describe, expect, it, vi } from "vitest";
import { ArtifactContentGrpcService } from "./artifact-content-grpc.service";

const tenant_id = "ten_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const run_id = "run_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const artifact_id = "art_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

describe("ArtifactContentGrpcService", () => {
  it("delegates real create and read operations through ArtifactsService", async () => {
    const content = new TextEncoder().encode("sandbox file");
    const artifacts = {
      create: vi.fn(async () => ({ id: artifact_id, sizeBytes: content.byteLength })),
      get: vi.fn(async () => ({ contentType: "text/plain", sizeBytes: content.byteLength })),
      read: vi.fn(async () => content),
    };
    const service = new ArtifactContentGrpcService(artifacts as never);
    await expect(service.createContent({ tenant_id, run_id, content_type: "text/plain", content })).resolves.toEqual({ artifact_id, size_bytes: content.byteLength });
    await expect(service.readContent({ tenant_id, artifact_id })).resolves.toEqual({ content_type: "text/plain", content, size_bytes: content.byteLength });
    expect(artifacts.create).toHaveBeenCalledWith(tenant_id, { runId: run_id, contentType: "text/plain", bytes: content });
  });
});
