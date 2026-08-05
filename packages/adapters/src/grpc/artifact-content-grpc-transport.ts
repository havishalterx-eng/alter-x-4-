import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import { GrpcMethod, RpcException, Transport, type MicroserviceOptions } from "@nestjs/microservices";
import type { ArtifactCreateContentRequest, ArtifactCreateContentResponse, ArtifactReadContentRequest, ArtifactReadContentResponse } from "@alterx/contracts";

export const ARTIFACT_CONTENT_HANDLER = Symbol("ARTIFACT_CONTENT_HANDLER");

export interface ArtifactContentHandler {
  createContent(request: ArtifactCreateContentRequest): Promise<ArtifactCreateContentResponse>;
  readContent(request: ArtifactReadContentRequest): Promise<ArtifactReadContentResponse>;
}

export interface ArtifactContentGrpcTransportConfig { readonly bindAddress: string; readonly protoPath: string; }

@Controller()
export class ArtifactContentGrpcController {
  constructor(@Inject(ARTIFACT_CONTENT_HANDLER) private readonly handler: ArtifactContentHandler) {}

  @GrpcMethod("ArtifactContentService", "CreateContent")
  async createContent(request: ArtifactCreateContentRequest): Promise<ArtifactCreateContentResponse> {
    try { return await this.handler.createContent(request); } catch (error: unknown) { throw mapArtifactError(error); }
  }

  @GrpcMethod("ArtifactContentService", "ReadContent")
  async readContent(request: ArtifactReadContentRequest): Promise<ArtifactReadContentResponse> {
    try { return await this.handler.readContent(request); } catch (error: unknown) { throw mapArtifactError(error); }
  }
}

export function connectArtifactContentGrpcTransport(app: INestApplication, config: ArtifactContentGrpcTransportConfig): void {
  app.connectMicroservice<MicroserviceOptions>({ transport: Transport.GRPC, options: { package: "alter.artifacts.v1", protoPath: config.protoPath, url: config.bindAddress, loader: { keepCase: true } } });
}

function mapArtifactError(error: unknown): RpcException {
  if (error instanceof Error && error.name === "ArtifactValidationError") return new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
  if (error instanceof Error && error.name === "ArtifactNotFoundError") return new RpcException({ code: status.NOT_FOUND, message: error.message });
  return new RpcException({ code: status.INTERNAL, message: "Artifact content operation could not be completed" });
}
