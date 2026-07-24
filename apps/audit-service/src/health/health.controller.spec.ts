import { ServiceUnavailableException } from "@nestjs/common";
import type { AuditStoreProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("returns ok for healthy audit store", async () => {
    const store = {
      healthCheck: vi.fn(async () => ({
        status: "healthy",
        checkedAt: "1970-01-01T00:00:00.000Z",
        latencyMs: 0,
      })),
    } as unknown as AuditStoreProvider;

    await expect(new HealthController(store).getHealth()).resolves.toEqual({
      status: "ok",
      service: "audit-service",
    });
  });

  it("does not expose database failures", async () => {
    const store = {
      healthCheck: vi.fn(async () => ({
        status: "unhealthy",
        checkedAt: "1970-01-01T00:00:00.000Z",
        latencyMs: 0,
      })),
    } as unknown as AuditStoreProvider;
    const controller = new HealthController(store);

    await expect(controller.getHealth()).rejects.toEqual(
      new ServiceUnavailableException("Audit database is unavailable"),
    );
  });
});
