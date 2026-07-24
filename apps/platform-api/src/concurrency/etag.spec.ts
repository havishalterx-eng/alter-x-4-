import type {
  ArgumentsHost,
  CallHandler,
  ExecutionContext,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { ProblemDetailsSchema } from "@alterx/contracts";
import { ConcurrencyModule } from "./concurrency.module";
import { ConcurrencyExceptionFilter } from "./concurrency-exception.filter";
import { EtagConstrained } from "./decorator";
import { computeEtag, ifMatchIncludes } from "./etag";
import { EtagResponseInterceptor } from "./etag.interceptor";
import {
  IfMatchGuard,
  type EtagResourceResolver,
} from "./if-match.guard";
import { ConcurrencyHttpError } from "./problem";

describe("ETag utilities", () => {
  it("computes stable content and version ETags", () => {
    expect(computeEtag({ b: 2, a: { z: 3, y: 2 } })).toBe(
      computeEtag({ a: { y: 2, z: 3 }, b: 2 }),
    );
    expect(computeEtag({ ignored: true }, 4)).toBe(
      computeEtag({ different: true }, 4),
    );
    expect(computeEtag({ value: 1 })).not.toBe(computeEtag({ value: 2 }));
    expect(computeEtag([{ b: 2, a: 1 }])).toBe(
      computeEtag([{ a: 1, b: 2 }]),
    );
    expect(computeEtag(undefined)).toMatch(/^".+"$/);
  });

  it("matches exact/list/wildcard values but not weak tags", () => {
    expect(ifMatchIncludes('"old", "current"', '"current"')).toBe(true);
    expect(ifMatchIncludes("*", '"current"')).toBe(true);
    expect(ifMatchIncludes('W/"current"', '"current"')).toBe(false);
  });
});

describe("IfMatchGuard", () => {
  it("allows a matching If-Match", async () => {
    const resource = { id: "workflow-1", version: 2 };
    const guard = new IfMatchGuard(resolver(resource, 2));
    const fixture = httpFixture(computeEtag(resource, 2));
    await expect(guard.canActivate(fixture.context)).resolves.toBe(true);
  });

  it("returns 412 and current ETag for stale If-Match", async () => {
    const resource = { id: "workflow-1", version: 2 };
    const current = computeEtag(resource, 2);
    const guard = new IfMatchGuard(resolver(resource, 2));
    const fixture = httpFixture('"stale"');

    const error = await guard
      .canActivate(fixture.context)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 412 });
    expect(fixture.header).toHaveBeenCalledWith("ETag", current);
    expect(
      ProblemDetailsSchema.safeParse(
        (error as { getResponse(): unknown }).getResponse(),
      ).success,
    ).toBe(true);
  });

  it("returns 428 when If-Match is missing", async () => {
    const guard = new IfMatchGuard(resolver({ id: "workflow-1" }));
    const fixture = httpFixture(undefined);
    await expect(guard.canActivate(fixture.context)).rejects.toMatchObject({
      status: 428,
    });
    fixture.request.url = "";
    await expect(guard.canActivate(fixture.context)).rejects.toMatchObject({
      response: { instance: "/" },
    });
  });

  it("accepts first value from repeated header representation", async () => {
    const guard = new IfMatchGuard(resolver({ id: "workflow-1" }));
    const fixture = httpFixture("*");
    fixture.request.headers["if-match"] = ["*", '"other"'];
    await expect(guard.canActivate(fixture.context)).resolves.toBe(true);
  });
});

describe("EtagResponseInterceptor", () => {
  it("sets new ETag from returned version", async () => {
    const fixture = httpFixture("*");
    const interceptor = new EtagResponseInterceptor();
    const body = { id: "workflow-1", version: 3 };
    const next: CallHandler = { handle: () => of(body) };

    await expect(
      firstValueFrom(interceptor.intercept(fixture.context, next)),
    ).resolves.toEqual(body);
    expect(fixture.header).toHaveBeenCalledWith(
      "ETag",
      computeEtag(body, 3),
    );
  });

  it("hashes primitive response bodies", async () => {
    const fixture = httpFixture("*");
    await firstValueFrom(
      new EtagResponseInterceptor().intercept(fixture.context, {
        handle: () => of("updated"),
      }),
    );
    expect(fixture.header).toHaveBeenCalledWith(
      "ETag",
      computeEtag("updated"),
    );

    await firstValueFrom(
      new EtagResponseInterceptor().intercept(fixture.context, {
        handle: () => of({ version: "release-2" }),
      }),
    );
    expect(fixture.header).toHaveBeenCalledWith(
      "ETag",
      computeEtag({}, "release-2"),
    );

    await firstValueFrom(
      new EtagResponseInterceptor().intercept(fixture.context, {
        handle: () => of({ version: null }),
      }),
    );
    await firstValueFrom(
      new EtagResponseInterceptor().intercept(fixture.context, {
        handle: () => of(null),
      }),
    );
  });
});

describe("ConcurrencyModule", () => {
  it("registers injectable resolver and decorator metadata", async () => {
    class Resolver implements EtagResourceResolver {
      resolve(): Promise<{ resource: unknown }> {
        return Promise.resolve({ resource: {} });
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [ConcurrencyModule.forFeature(Resolver)],
    }).compile();

    expect(moduleRef.get(IfMatchGuard)).toBeInstanceOf(IfMatchGuard);
    expect(EtagConstrained()).toBeDefined();
    await moduleRef.close();
  });

  it("renders concurrency errors as application/problem+json", () => {
    const status = vi.fn().mockReturnThis();
    const type = vi.fn().mockReturnThis();
    const send = vi.fn();
    const reply = { status, type, send };
    const host = {
      switchToHttp: () => ({ getResponse: () => reply }),
    } as unknown as ArgumentsHost;
    const error = new ConcurrencyHttpError(
      412,
      "ETAG_MISMATCH",
      "Stale",
      "/api/v1/workflows/1",
    );

    new ConcurrencyExceptionFilter().catch(error, host);
    expect(status).toHaveBeenCalledWith(412);
    expect(type).toHaveBeenCalledWith("application/problem+json");
    expect(send).toHaveBeenCalledWith(error.getResponse());
  });
});

function resolver(
  resource: unknown,
  version?: string | number,
): EtagResourceResolver {
  return {
    resolve: vi.fn().mockResolvedValue({
      resource,
      ...(version === undefined ? {} : { version }),
    }),
  };
}

function httpFixture(ifMatch: string | undefined): {
  context: ExecutionContext;
  request: {
    url: string;
    headers: Record<string, string | string[] | undefined>;
  };
  header: ReturnType<typeof vi.fn>;
} {
  const request = {
    url: "/api/v1/workflows/workflow-1?view=full",
    headers: { "if-match": ifMatch },
  };
  const header = vi.fn();
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ header }),
    }),
  } as unknown as ExecutionContext;
  return { context, request, header };
}
