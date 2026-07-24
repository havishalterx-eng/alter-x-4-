import type {
  ArgumentsHost,
  CallHandler,
  ExecutionContext,
} from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { PgIdempotencyStore } from "./idempotency-store";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { Idempotent } from "./decorator";
import { IdempotencyExceptionFilter } from "./idempotency-exception.filter";
import { IdempotencyHttpError } from "./problem";

describe("IdempotencyInterceptor", () => {
  it("executes first request and returns controller response", async () => {
    const execute = vi.fn(
      async (
        _input: unknown,
        operation: () => Promise<{ status: number; body: unknown }>,
      ) => ({ ...(await operation()), replayed: false }),
    );
    const interceptor = new IdempotencyInterceptor({
      execute,
    } as unknown as PgIdempotencyStore);
    const fixture = httpFixture();

    await expect(
      firstValueFrom(
        interceptor.intercept(fixture.context, {
          handle: () => of({ id: "workflow-1" }),
        }),
      ),
    ).resolves.toEqual({ id: "workflow-1" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        key: "key-1",
        instance: "/api/v1/workflows",
      }),
      expect.any(Function),
    );
    expect(fixture.status).toHaveBeenCalledWith(201);
  });

  it("returns stored status/body and marks replay", async () => {
    const interceptor = new IdempotencyInterceptor({
      execute: vi.fn().mockResolvedValue({
        status: 202,
        body: { id: "run-1" },
        replayed: true,
      }),
    } as unknown as PgIdempotencyStore);
    const fixture = httpFixture();
    const next: CallHandler = {
      handle: vi.fn(() => of({ shouldNotRun: true })),
    };

    await expect(
      firstValueFrom(interceptor.intercept(fixture.context, next)),
    ).resolves.toEqual({ id: "run-1" });
    expect(next.handle).not.toHaveBeenCalled();
    expect(fixture.status).toHaveBeenCalledWith(202);
    expect(fixture.header).toHaveBeenCalledWith(
      "Idempotency-Replayed",
      "true",
    );
  });

  it("rejects missing tenant context before store access", () => {
    const store = { execute: vi.fn() };
    const interceptor = new IdempotencyInterceptor(
      store as unknown as PgIdempotencyStore,
    );
    const fixture = httpFixture(false);

    try {
      interceptor.intercept(fixture.context, { handle: () => of({}) });
      throw new Error("Expected missing tenant rejection");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        response: { error_code: "TENANT_CONTEXT_REQUIRED" },
      });
    }
    expect(store.execute).not.toHaveBeenCalled();
  });

  it("supports repeated header representation and forwards errors", async () => {
    const fixture = httpFixture();
    fixture.request.headers["idempotency-key"] = ["first", "second"];
    const interceptor = new IdempotencyInterceptor({
      execute: vi.fn().mockRejectedValue(new Error("store failed")),
    } as unknown as PgIdempotencyStore);

    await expect(
      firstValueFrom(
        interceptor.intercept(fixture.context, { handle: () => of({}) }),
      ),
    ).rejects.toThrow("store failed");
  });

  it("normalizes missing key and empty URL", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 200,
      body: null,
      replayed: false,
    });
    const fixture = httpFixture();
    fixture.request.url = "";
    delete fixture.request.headers["idempotency-key"];
    await firstValueFrom(
      new IdempotencyInterceptor({
        execute,
      } as unknown as PgIdempotencyStore).intercept(fixture.context, {
        handle: () => of(null),
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ key: "", instance: "/" }),
      expect.any(Function),
    );
    expect(Idempotent()).toBeDefined();
  });

  it("renders idempotency errors as application/problem+json", () => {
    const status = vi.fn().mockReturnThis();
    const type = vi.fn().mockReturnThis();
    const send = vi.fn();
    const reply = { status, type, send };
    const host = {
      switchToHttp: () => ({ getResponse: () => reply }),
    } as unknown as ArgumentsHost;
    const error = new IdempotencyHttpError(
      422,
      "IDEMPOTENCY_KEY_REUSED",
      "Conflict",
      "/api/v1/workflows",
    );

    new IdempotencyExceptionFilter().catch(error, host);
    expect(status).toHaveBeenCalledWith(422);
    expect(type).toHaveBeenCalledWith("application/problem+json");
    expect(send).toHaveBeenCalledWith(error.getResponse());
  });
});

function httpFixture(withActor = true): {
  context: ExecutionContext;
  request: {
    method: string;
    url: string;
    body: unknown;
    headers: Record<string, string | string[]>;
    actorContext?: { tenant_id: string };
  };
  status: ReturnType<typeof vi.fn>;
  header: ReturnType<typeof vi.fn>;
} {
  const request = {
    method: "POST",
    url: "/api/v1/workflows?source=ui",
    body: { goal: "ship" },
    headers: { "idempotency-key": "key-1" } as Record<
      string,
      string | string[]
    >,
    ...(withActor ? { actorContext: { tenant_id: "tenant-a" } } : {}),
  };
  const status = vi.fn();
  const header = vi.fn();
  const reply = { statusCode: 201, status, header };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
  return { context, request, status, header };
}
