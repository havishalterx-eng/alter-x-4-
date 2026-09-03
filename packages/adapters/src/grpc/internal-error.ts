import { status } from "@grpc/grpc-js";
import { Logger } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";

const logger = new Logger("GrpcTransport");

/**
 * Return the generic INTERNAL fault the client sees, after recording the real
 * cause in the server log.
 *
 * The transport mappers deliberately do not leak internal failure detail to
 * callers, but they previously discarded `error` entirely rather than logging
 * it. A failing RPC then produced a fixed sentence on the client and no server
 * log line at all, so the cause was unavailable from either side and could only
 * be recovered by reading the source. Keep the opaque client message; keep the
 * cause for the operator.
 */
export function internalError(error: unknown, message: string): RpcException {
  logger.error(message, error instanceof Error ? error.stack : String(error));
  return new RpcException({ code: status.INTERNAL, message });
}
