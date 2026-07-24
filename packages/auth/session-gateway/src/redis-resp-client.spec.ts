import { describe, expect, it } from "vitest";
import { RedisRespSetClient } from "./redis-resp-client";

describe("RedisRespSetClient configuration", () => {
  it("accepts Redis endpoints without credentials", () => {
    expect(
      new RedisRespSetClient("rediss://blackboard.example:6379"),
    ).toBeInstanceOf(RedisRespSetClient);
  });

  it("rejects unsupported schemes and embedded credentials", () => {
    expect(() => new RedisRespSetClient("https://blackboard.example")).toThrow(
      "redis:// or rediss://",
    );
    expect(
      () =>
        new RedisRespSetClient(
          "rediss://default:credential@blackboard.example:6379",
        ),
    ).toThrow("must be resolved by an approved adapter");
  });
});
