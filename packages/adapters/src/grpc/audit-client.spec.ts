import { describe, expect, it, vi } from "vitest";

import type { RecordEventRequest, RecordEventResponse } from "@alterx/contracts";
import { AuditServiceClient } from "./audit-client";

function fakeGrpcClient(
  handler: (
    request: RecordEventRequest,
  ) => { error: Error | null; response?: RecordEventResponse },
) {
  return {
    recordEvent: vi.fn(
      (
        request: RecordEventRequest,
        _options: unknown,
        callback: (
          error: Error | null,
          response?: RecordEventResponse,
        ) => void,
      ) => {
        const { error, response } = handler(request);
        callback(error, response);
      },
    ),
  };
}

const REQUEST: RecordEventRequest = {
  tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
  actor_type: "service",
  actor_ref: "tool-gateway",
  action: "tool.invoke",
  target_type: "tool",
  target_ref: "search.web",
  result: "success",
  reason_code: "",
  context_json: "{}",
  occurred_at: "2026-07-24T00:00:00.000Z",
};

describe("AuditServiceClient", () => {
  it("resolves with the recorded event id and hash", async () => {
    const grpcClient = fakeGrpcClient(() => ({
      error: null,
      response: { id: "aud_018f47a2", entry_hash: "deadbeef" },
    }));
    const client = new AuditServiceClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    const response = await client.recordEvent(REQUEST);

    expect(response).toEqual({ id: "aud_018f47a2", entry_hash: "deadbeef" });
    expect(grpcClient.recordEvent).toHaveBeenCalledWith(
      REQUEST,
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
  });

  it("rejects when the gRPC call errors", async () => {
    const grpcClient = fakeGrpcClient(() => ({
      error: new Error("unavailable"),
    }));
    const client = new AuditServiceClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.recordEvent(REQUEST)).rejects.toThrow("unavailable");
  });

  it("rejects when the response is empty", async () => {
    const grpcClient = fakeGrpcClient(() => ({ error: null }));
    const client = new AuditServiceClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.recordEvent(REQUEST)).rejects.toThrow(
      "empty response",
    );
  });

  it("propagates an acquired M2M token", async () => {
    const grpcClient = {
      recordEvent: vi.fn(
        (_request: unknown, metadata: { get(key: string): readonly string[] }, _options: unknown, callback: (error: null, response: RecordEventResponse) => void) => {
          expect(metadata.get("authorization")).toEqual(["Bearer signed-m2m-token"]);
          callback(null, { id: "aud_018f47a2", entry_hash: "deadbeef" });
        },
      ),
    };
    const client = new AuditServiceClient(
      {
        address: "localhost:1234",
        protoPath: "unused",
        accessTokenProvider: { getAccessToken: async () => "signed-m2m-token" },
      },
      grpcClient as never,
    );

    await expect(client.recordEvent(REQUEST)).resolves.toEqual({
      id: "aud_018f47a2",
      entry_hash: "deadbeef",
    });
  });
});
