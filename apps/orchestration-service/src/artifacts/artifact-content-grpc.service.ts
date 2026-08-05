import type { ArtifactContentHandler } from "@alterx/adapters";
import type { ArtifactCreateContentRequest, ArtifactCreateContentResponse, ArtifactReadContentRequest, ArtifactReadContentResponse } from "@alterx/contracts";
import { ArtifactsService } from "./artifacts.service";

/** Internal gRPC facade; persistence and tenant checks remain in ArtifactsService. */
export class ArtifactContentGrpcService implements ArtifactContentHandler {
  constructor(private readonly artifacts: ArtifactsService) {}

  async createContent(request: ArtifactCreateContentRequest): Promise<ArtifactCreateContentResponse> {
    const artifact = await this.artifacts.create(request.tenant_id, { runId: request.run_id, contentType: request.content_type, bytes: request.content });
    return { artifact_id: artifact.id, size_bytes: artifact.sizeBytes };
  }

  async readContent(request: ArtifactReadContentRequest): Promise<ArtifactReadContentResponse> {
    const artifact = await this.artifacts.get(request.tenant_id, request.artifact_id);
    const content = await this.artifacts.read(request.tenant_id, request.artifact_id);
    return { content_type: artifact.contentType, content, size_bytes: artifact.sizeBytes };
  }
}
