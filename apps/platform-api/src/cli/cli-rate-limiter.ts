import { Injectable } from "@nestjs/common";
import type { CliConfigProvider } from "./cli-config";

@Injectable()
export class CliRateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(private readonly config: CliConfigProvider) {}

  async allow(clientAddress: string, endpoint: string, now = Date.now()): Promise<boolean> {
    const policy = await this.config.getCliPolicy();
    const key = `${clientAddress}:${endpoint}`;
    const windowStart = now - 60_000;
    const attempts = (this.requests.get(key) ?? []).filter((time) => time > windowStart);
    if (attempts.length >= policy.deviceFlowRateLimitPerMinute) {
      this.requests.set(key, attempts);
      return false;
    }
    attempts.push(now);
    this.requests.set(key, attempts);
    return true;
  }
}
