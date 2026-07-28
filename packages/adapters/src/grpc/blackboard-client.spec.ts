import { describe, expect, it, vi } from "vitest";

import type {
  BlackboardReadValueRequest,
  BlackboardWriteValueRequest,
} from "@alterx/contracts";
import { BlackboardClient } from "./blackboard-client";

const TENANT_ID = "ten_018f47a2-7b11-7b11-8a11-1234567890ab";
const RUN_ID = "run_018f47a2-7b11-7b11-8a11-1234567890ab";

describe("BlackboardClient", () => {
  it("writeValue resolves with the service's response", async () => {
    const writeValue = vi.fn(
      (
        _request: BlackboardWriteValueRequest,
        _options: unknown,
        callback: (error: Error | null, response?: object) => void,
      ) => callback(null, {}),
    );
    const client = new BlackboardClient(
      { address: "localhost:1234", protoPath: "unused" },
      { writeValue, readValue: vi.fn() } as never,
    );

    await expect(
      client.writeValue({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        key: "node_a",
        value_json: "{}",
      }),
    ).resolves.toEqual({});
  });

  it("writeValue rejects when the gRPC call errors", async () => {
    const writeValue = vi.fn(
      (
        _request: BlackboardWriteValueRequest,
        _options: unknown,
        callback: (error: Error | null) => void,
      ) => callback(new Error("unavailable")),
    );
    const client = new BlackboardClient(
      { address: "localhost:1234", protoPath: "unused" },
      { writeValue, readValue: vi.fn() } as never,
    );

    await expect(
      client.writeValue({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        key: "node_a",
        value_json: "{}",
      }),
    ).rejects.toThrow("unavailable");
  });

  it("readValue resolves found=true with value_json", async () => {
    const readValue = vi.fn(
      (
        _request: BlackboardReadValueRequest,
        _options: unknown,
        callback: (error: Error | null, response?: object) => void,
      ) => callback(null, { found: true, value_json: JSON.stringify({ x: 1 }) }),
    );
    const client = new BlackboardClient(
      { address: "localhost:1234", protoPath: "unused" },
      { writeValue: vi.fn(), readValue } as never,
    );

    const response = await client.readValue({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      key: "node_a",
    });

    expect(response).toEqual({ found: true, value_json: JSON.stringify({ x: 1 }) });
  });

  it("readValue resolves found=false when the key is absent", async () => {
    const readValue = vi.fn(
      (
        _request: BlackboardReadValueRequest,
        _options: unknown,
        callback: (error: Error | null, response?: object) => void,
      ) => callback(null, { found: false, value_json: "" }),
    );
    const client = new BlackboardClient(
      { address: "localhost:1234", protoPath: "unused" },
      { writeValue: vi.fn(), readValue } as never,
    );

    await expect(
      client.readValue({ tenant_id: TENANT_ID, run_id: RUN_ID, key: "node_missing" }),
    ).resolves.toEqual({ found: false, value_json: "" });
  });

  it("readValue rejects when the response is empty", async () => {
    const readValue = vi.fn(
      (
        _request: BlackboardReadValueRequest,
        _options: unknown,
        callback: (error: Error | null) => void,
      ) => callback(null),
    );
    const client = new BlackboardClient(
      { address: "localhost:1234", protoPath: "unused" },
      { writeValue: vi.fn(), readValue } as never,
    );

    await expect(
      client.readValue({ tenant_id: TENANT_ID, run_id: RUN_ID, key: "node_a" }),
    ).rejects.toThrow("empty response");
  });
});
