import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { IdempotencyModule } from "./idempotency.module";
import { PgIdempotencyStore } from "./idempotency-store";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("IdempotencyModule", () => {
  it("accepts configured positive TTL", async () => {
    process.env.DATABASE_URL = "postgres://localhost/platform";
    process.env.IDEMPOTENCY_TTL_SECONDS = "120";
    const moduleRef = await Test.createTestingModule({
      imports: [IdempotencyModule],
    }).compile();
    expect(moduleRef.get(PgIdempotencyStore)).toBeInstanceOf(
      PgIdempotencyStore,
    );
    await moduleRef.close();
  });

  it("fails module creation for invalid TTL", async () => {
    process.env.DATABASE_URL = "postgres://localhost/platform";
    process.env.IDEMPOTENCY_TTL_SECONDS = "0";
    await expect(
      Test.createTestingModule({ imports: [IdempotencyModule] }).compile(),
    ).rejects.toThrow("IDEMPOTENCY_TTL_SECONDS must be a positive integer");
  });
});
