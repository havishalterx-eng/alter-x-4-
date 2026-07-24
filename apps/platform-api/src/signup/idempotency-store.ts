import { createHash } from "node:crypto";
import { PlatformHttpError } from "./problem";

interface Entry<T> {
  requestHash: string;
  result: Promise<T>;
}

export interface IdempotencyStore {
  execute<T>(key: string, payload: unknown, operation: () => Promise<T>): Promise<T>;
}

/**
 * Current signup idempotency method. Process-local and intentionally temporary;
 * Product Core must replace it with durable PostgreSQL storage before multi-instance deploys.
 */
export class ProcessLocalSignupIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry<unknown>>();

  async execute<T>(
    key: string,
    payload: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!key.trim()) {
      throw new PlatformHttpError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key header required",
        "/api/v1/signup",
      );
    }

    const requestHash = hashPayload(payload);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new PlatformHttpError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key was already used with a different request",
          "/api/v1/signup",
        );
      }
      return existing.result as Promise<T>;
    }

    const result = operation();
    this.entries.set(key, { requestHash, result });
    try {
      return await result;
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
