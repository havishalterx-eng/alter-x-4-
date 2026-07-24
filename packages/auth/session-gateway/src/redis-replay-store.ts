import type { ReplayStore } from "./types";

export interface RedisSetClient {
  set(
    key: string,
    value: string,
    options: { readonly nx: true; readonly ex: number },
  ): Promise<"OK" | null>;
}

export class RedisReplayStore implements ReplayStore {
  constructor(private readonly client: RedisSetClient) {}

  async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new Error("Replay TTL must be a positive integer");
    }
    return (
      (await this.client.set(key, "1", {
        nx: true,
        ex: ttlSeconds,
      })) === "OK"
    );
  }
}
