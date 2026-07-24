import { describe, expect, it, vi } from "vitest";
import { RedisReplayStore, type RedisSetClient } from "./redis-replay-store";

describe("RedisReplayStore", () => {
  it("uses atomic NX with a bounded expiry", async () => {
    const client: RedisSetClient = {
      set: vi.fn().mockResolvedValue("OK"),
    };
    await expect(
      new RedisReplayStore(client).setIfAbsent("blackboard:actor_jti:id", 42),
    ).resolves.toBe(true);
    expect(client.set).toHaveBeenCalledWith(
      "blackboard:actor_jti:id",
      "1",
      { nx: true, ex: 42 },
    );
  });

  it("reports replay and rejects invalid TTLs", async () => {
    const client: RedisSetClient = {
      set: vi.fn().mockResolvedValue(null),
    };
    const store = new RedisReplayStore(client);
    await expect(store.setIfAbsent("key", 30)).resolves.toBe(false);
    await expect(store.setIfAbsent("key", 0)).rejects.toThrow(
      "Replay TTL must be a positive integer",
    );
  });
});
