import { credentials, loadPackageDefinition, status, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import type { ArtifactCreateContentRequest, ArtifactCreateContentResponse, ArtifactReadContentRequest, ArtifactReadContentResponse } from "@alterx/contracts";

export interface ArtifactContentClientConfig { readonly address: string; readonly protoPath: string; readonly timeoutMs?: number; }
export interface ArtifactContentClientHandler { createContent(request: ArtifactCreateContentRequest): Promise<ArtifactCreateContentResponse>; readContent(request: ArtifactReadContentRequest): Promise<ArtifactReadContentResponse>; }
export class ArtifactContentClientError extends Error { constructor(readonly retryable: boolean, options: ErrorOptions = {}) { super("Artifact Content Service request failed", options); this.name = "ArtifactContentClientError"; } }
interface ArtifactContentGrpcClient extends Client {
  createContent(request: ArtifactCreateContentRequest, options: { readonly deadline: Date }, callback: (error: (Error & { readonly code?: number }) | null, response?: ArtifactCreateContentResponse) => void): void;
  readContent(request: ArtifactReadContentRequest, options: { readonly deadline: Date }, callback: (error: (Error & { readonly code?: number }) | null, response?: ArtifactReadContentResponse) => void): void;
}
const DEFAULT_TIMEOUT_MS = 10_000;
export class ArtifactContentClient implements ArtifactContentClientHandler {
  readonly #client: ArtifactContentGrpcClient; readonly #timeoutMs: number;
  constructor(config: ArtifactContentClientConfig, client?: ArtifactContentGrpcClient) { this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS; this.#client = client ?? ArtifactContentClient.#buildClient(config); }
  static #buildClient(config: ArtifactContentClientConfig): ArtifactContentGrpcClient {
    const definition = loadSync(config.protoPath, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const proto = loadPackageDefinition(definition) as unknown as { alter: { artifacts: { v1: { ArtifactContentService: new (address: string, creds: ReturnType<typeof credentials.createInsecure>) => ArtifactContentGrpcClient } } } };
    return new proto.alter.artifacts.v1.ArtifactContentService(config.address, credentials.createInsecure());
  }
  createContent(request: ArtifactCreateContentRequest): Promise<ArtifactCreateContentResponse> { return this.#call("createContent", request); }
  readContent(request: ArtifactReadContentRequest): Promise<ArtifactReadContentResponse> { return this.#call("readContent", request); }
  #call<TRequest, TResponse>(method: "createContent" | "readContent", request: TRequest): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const callback = (error: (Error & { readonly code?: number }) | null, response?: TResponse) => {
        if (error !== null) { reject(new ArtifactContentClientError(error.code === status.DEADLINE_EXCEEDED || error.code === status.UNAVAILABLE, { cause: error })); return; }
        if (response === undefined) { reject(new ArtifactContentClientError(false)); return; }
        resolve(response);
      };
      const options = { deadline: new Date(Date.now() + this.#timeoutMs) };
      if (method === "createContent") this.#client.createContent(request as ArtifactCreateContentRequest, options, callback as never);
      else this.#client.readContent(request as ArtifactReadContentRequest, options, callback as never);
    });
  }
}
