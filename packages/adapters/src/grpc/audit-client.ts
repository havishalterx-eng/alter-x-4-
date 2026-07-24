import { credentials, loadPackageDefinition, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type { RecordEventRequest, RecordEventResponse } from "@alterx/contracts";
import type { AuditEventHandler } from "@alterx/shared-clients";

export interface AuditServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

interface AuditServiceGrpcClient extends Client {
  recordEvent(
    request: RecordEventRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: RecordEventResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class AuditServiceClient implements AuditEventHandler {
  readonly #client: AuditServiceGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: AuditServiceClientConfig, client?: AuditServiceGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
      this.#client.recordEvent(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Audit service returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }
}
