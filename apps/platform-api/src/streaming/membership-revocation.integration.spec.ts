import { describe, expect, it, vi } from "vitest";
import type {
  EngineCallerContext,
  EngineEventStream,
  EngineSseMessage,
} from "../engine";
import { MembersService } from "../members/members.service";
import type { ActorContext } from "../rbac/types";
import { PlatformDb } from "../signup/platform-db";
import { StreamRevocationBus } from "./revocation";
import { StreamGateway } from "./stream-gateway";

const tenantId = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const removedUserId = "usr_018f47a5-7b2c-7d10-8f11-123456789abc";

describe("membership stream revocation", () => {
  it("closes an active stream when membership is removed mid-stream", async () => {
    const source = new PendingStream<EngineSseMessage>();
    const close = vi.fn(() => source.end());
    const engine = {
      stream: vi.fn(async (): Promise<EngineEventStream> => ({
        messages: source,
        close,
      })),
    };
    const revocations = new StreamRevocationBus();
    const gateway = new StreamGateway(
      engine as unknown as import("../engine").EngineClient,
      {
        replayBufferSize: 8,
        subscriberQueueSize: 8,
        heartbeatMs: 60_000,
        replayGraceMs: 1_000,
      },
      revocations,
    );
    const connection = await gateway.connect({
      tabId: "active-tab",
      target: {
        kind: "run",
        runId: "run_018f47a5-7b2c-7d10-8f11-123456789abc",
      },
      context: streamContext(),
      sink: async () => undefined,
    });
    connection.start();
    const members = new MembersService(
      {
        queryTenant: vi.fn().mockResolvedValue([{ userId: removedUserId }]),
      } as unknown as PlatformDb,
      revocations,
    );

    await members.remove(adminActor(), "membership-id", "workspace");
    await connection.closed;

    expect(close).toHaveBeenCalledOnce();
    expect(gateway.activeChannelCount()).toBe(0);
  });
});

function streamContext(): EngineCallerContext {
  return {
    userId: removedUserId,
    tenantId,
    workspaceId: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
    sessionId: "removed-session",
    authTime: 1_700_000_000,
    roles: ["viewer"],
    permissions: ["runs:read"],
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
  };
}

function adminActor(): ActorContext {
  return {
    user_id: "admin-user",
    tenant_id: tenantId,
    session_id: "admin-session",
    roles: ["owner"],
    permissions: [],
  };
}

class PendingStream<T> implements AsyncIterable<T> {
  private done = false;
  private resolve:
    | ((result: IteratorResult<T>) => void)
    | undefined;

  end(): void {
    this.done = true;
    this.resolve?.({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.done) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}
