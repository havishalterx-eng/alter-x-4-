import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { status } from "@grpc/grpc-js";

import { M2mValidator } from "./m2m-validator";
import { PUBLIC_ROUTE_METADATA } from "./public-route";

interface GrpcMetadataLike {
  get(key: string): unknown;
}

/**
 * Default-deny authentication for internal HTTP and gRPC service transports.
 * gRPC credentials live in metadata, never in the decoded protobuf message.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly m2mValidator: M2mValidator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(context)) return true;

    const authorization =
      context.getType() === "rpc"
        ? rpcAuthorization(context)
        : httpAuthorization(context);

    try {
      await this.m2mValidator.validate(authorization);
      return true;
    } catch {
      if (context.getType() === "rpc") {
        throw new RpcException({
          code: status.UNAUTHENTICATED,
          message: "Internal service credential is invalid.",
        });
      }
      throw new UnauthorizedException("Internal service credential is invalid.");
    }
  }
}

function isPublic(context: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(PUBLIC_ROUTE_METADATA, context.getHandler()) === true ||
    Reflect.getMetadata(PUBLIC_ROUTE_METADATA, context.getClass()) === true
  );
}

function httpAuthorization(context: ExecutionContext): string | undefined {
  const request = context.switchToHttp().getRequest<{
    readonly headers?: Record<string, string | string[] | undefined>;
  }>();
  return firstValue(request?.headers?.["authorization"]);
}

function rpcAuthorization(context: ExecutionContext): string | undefined {
  const metadata = context.switchToRpc().getContext<GrpcMetadataLike | undefined>();
  return metadata === undefined || typeof metadata.get !== "function"
    ? undefined
    : firstValue(metadata.get("authorization"));
}

function firstValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string"
    ? value[0]
    : undefined;
}
