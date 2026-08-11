import { credentials, loadPackageDefinition, type Client, type Metadata } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  GetEventRequest,
  GetEventResponse,
  RecordEventRequest,
  RecordEventResponse,
} from "@alterx/contracts";
import type { AuditEventHandler } from "@alterx/shared-clients";
import { serviceAuthorizationMetadata, type ServiceAccessTokenProvider } from "./service-auth";

export interface AuditServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
  readonly accessTokenProvider?: ServiceAccessTokenProvider;
}

interface AuditServiceGrpcClient extends Client {
  recordEvent(request: RecordEventRequest, options: { readonly deadline: Date }, callback: (error: Error | null, response?: RecordEventResponse) => void): void;
  recordEvent(
    request: RecordEventRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: RecordEventResponse) => void,
  ): void;
  getEvent(
    request: GetEventRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: GetEventResponse) => void,
  ): void;
  getEvent(
    request: GetEventRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: GetEventResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class AuditServiceClient implements AuditEventHandler {
  readonly #client: AuditServiceGrpcClient;
  readonly #timeoutMs: number;
  readonly #accessTokenProvider: ServiceAccessTokenProvider | undefined;

  constructor(config: AuditServiceClientConfig, client?: AuditServiceGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#accessTokenProvider = config.accessTokenProvider;
    this.#client = client ?? AuditServiceClient.#buildClient(config);
  }

  static #buildClient(config: AuditServiceClientConfig): AuditServiceGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        audit: {
          v1: {
            AuditService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => AuditServiceGrpcClient;
          };
        };
      };
    };
    return new proto.alter.audit.v1.AuditService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async recordEvent(
    request: RecordEventRequest,
  ): Promise<RecordEventResponse> {
    return new Promise<RecordEventResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      const callback = (error: Error | null, response?: RecordEventResponse) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Audit service returned an empty response"));
          return;
        }
        resolve(response);
      };
      if (this.#accessTokenProvider === undefined) this.#client.recordEvent(request, { deadline }, callback);
      else void serviceAuthorizationMetadata(this.#accessTokenProvider).then((metadata) => this.#client.recordEvent(request, metadata, { deadline }, callback), reject);
    });
  }

  async getEvent(request: GetEventRequest): Promise<GetEventResponse> {
    return new Promise<GetEventResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      const callback = (error: Error | null, response?: GetEventResponse) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Audit service returned an empty response"));
          return;
        }
        resolve(response);
      };
      if (this.#accessTokenProvider === undefined) this.#client.getEvent(request, { deadline }, callback);
      else void serviceAuthorizationMetadata(this.#accessTokenProvider).then((metadata) => this.#client.getEvent(request, metadata, { deadline }, callback), reject);
    });
  }
}
