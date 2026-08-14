import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";
import { Observable } from "rxjs";

import type {
  ModelgwEmbedRequest,
  ModelgwEmbedResponse,
  ModelgwInvokeRequest,
  ModelgwInvokeResponse,
  ModelgwRedactRequest,
  ModelgwRedactResponse,
  ModelgwStreamRequest,
  ModelgwStreamResponse,
  ModelgwSelectFallbackResponse,
} from "@alterx/contracts";
import {
  InvalidModelAliasError,
  ModelAliasResolutionError,
  ModelGatewayCostLimitExceededError,
  ModelGatewayInvalidResponseError,
} from "@alterx/shared-clients";

export const MODELGW_HANDLER = Symbol("MODELGW_HANDLER");

export interface ModelgwHandler {
  invoke(request: ModelgwInvokeRequest): Promise<ModelgwInvokeResponse>;
  stream(request: ModelgwStreamRequest): AsyncIterable<ModelgwStreamResponse>;
  redact(request: ModelgwRedactRequest): Promise<ModelgwRedactResponse>;
  embed(request: ModelgwEmbedRequest): Promise<ModelgwEmbedResponse>;
}

export interface ModelgwGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class ModelgwGrpcController {
  constructor(
    @Inject(MODELGW_HANDLER)
    private readonly handler: ModelgwHandler,
  ) {}

  @GrpcMethod("ModelgwService", "Invoke")
  async invoke(
    request: ModelgwInvokeRequest,
  ): Promise<ModelgwInvokeResponse> {
    try {
      return await this.handler.invoke(request);
    } catch (error: unknown) {
      throw mapModelgwError(error, "Model invocation could not be completed");
    }
  }

  @GrpcMethod("ModelgwService", "Stream")
  stream(request: ModelgwStreamRequest): Observable<ModelgwStreamResponse> {
    return new Observable((subscriber) => {
      let cancelled = false;
      let iterator: AsyncIterator<ModelgwStreamResponse> | undefined;
      void (async () => {
        try {
          iterator = this.handler.stream(request)[Symbol.asyncIterator]();
          while (!cancelled) {
            const item = await iterator.next();
            if (item.done) {
              subscriber.complete();
              return;
            }
            subscriber.next(item.value);
          }
        } catch (error: unknown) {
          subscriber.error(
            mapModelgwError(error, "Model stream could not be completed"),
          );
        }
      })();
      return () => {
        cancelled = true;
        const returned = iterator?.return?.();
        if (returned !== undefined) {
          void Promise.resolve(returned).catch(() => undefined);
        }
      };
    });
  }

  @GrpcMethod("ModelgwService", "Redact")
  async redact(
    request: ModelgwRedactRequest,
  ): Promise<ModelgwRedactResponse> {
    try {
      return await this.handler.redact(request);
    } catch {
      throw new RpcException({
        code: status.INTERNAL,
        message: "PII redaction could not be completed",
      });
    }
  }

  // Automatic fallback-chain selection is GATE-3.
  @GrpcMethod("ModelgwService", "SelectFallback")
  selectFallback(): ModelgwSelectFallbackResponse {
    throw new RpcException({
      code: status.UNIMPLEMENTED,
      message: "Fallback selection ships in GATE-3",
    });
  }

  @GrpcMethod("ModelgwService", "Embed")
  async embed(request: ModelgwEmbedRequest): Promise<ModelgwEmbedResponse> {
    try {
      return await this.handler.embed(request);
    } catch {
      throw new RpcException({
        code: status.INTERNAL,
        message: "Embedding could not be completed",
      });
    }
  }
}

function mapModelgwError(error: unknown, fallbackMessage: string): RpcException {
  if (
    error instanceof ModelAliasResolutionError ||
    error instanceof InvalidModelAliasError
  ) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (error instanceof ModelGatewayCostLimitExceededError) {
    return new RpcException({
      code: status.RESOURCE_EXHAUSTED,
      message: error.message,
    });
  }
  if (error instanceof ModelGatewayInvalidResponseError) {
    return new RpcException({ code: status.INTERNAL, message: error.message });
  }
  // Every other error type is collapsed into a generic client-safe message
  // below (no internal detail over the wire) -- log the real cause here or
  // it's gone.
  console.error("modelgw invoke failed:", error);
  return new RpcException({ code: status.INTERNAL, message: fallbackMessage });
}

export async function startModelgwGrpcTransport(
  app: INestApplication,
  config: ModelgwGrpcTransportConfig,
): Promise<void> {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.modelgw.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  }, { inheritAppConfig: true });
  await app.startAllMicroservices();
}
