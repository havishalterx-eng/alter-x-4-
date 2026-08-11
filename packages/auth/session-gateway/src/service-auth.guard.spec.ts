import { type ExecutionContext } from "@nestjs/common";
import { status } from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";

import type { M2mValidator } from "./m2m-validator";
import { PUBLIC_ROUTE_METADATA } from "./public-route";
import { ServiceAuthGuard } from "./service-auth.guard";

function rpcContext(authorization: string[] | undefined): ExecutionContext {
  const handler = () => undefined;
  return {
    getType: () => "rpc",
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToRpc: () => ({
      getContext: () => ({
        get: (key: string) => (key === "authorization" ? authorization : undefined),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe("ServiceAuthGuard", () => {
  it("accepts only valid gRPC metadata", async () => {
    const validate = vi.fn().mockResolvedValue({});
    const guard = new ServiceAuthGuard({ validate } as unknown as M2mValidator);

    await expect(guard.canActivate(rpcContext(["Bearer machine"]))).resolves.toBe(true);
    expect(validate).toHaveBeenCalledWith("Bearer machine");
  });

  it("rejects missing gRPC metadata", async () => {
    const guard = new ServiceAuthGuard({
      validate: vi.fn().mockRejectedValue(new Error("invalid")),
    } as unknown as M2mValidator);

    await expect(guard.canActivate(rpcContext(undefined))).rejects.toMatchObject({
      error: { code: status.UNAUTHENTICATED },
    });
  });

  it("bypasses only explicitly public routes", async () => {
    const validate = vi.fn().mockRejectedValue(new Error("invalid"));
    const guard = new ServiceAuthGuard({ validate } as unknown as M2mValidator);
    const context = rpcContext(undefined);
    Reflect.defineMetadata(PUBLIC_ROUTE_METADATA, true, context.getHandler());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(validate).not.toHaveBeenCalled();
  });
});
