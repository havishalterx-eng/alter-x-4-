import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { ConnectorHealthSweepController } from "./connector-health-sweep.controller";
import type { IntegrationService } from "./integration.service";

const REAL_TOKEN = "real-shared-secret";
const TOKEN_HASH = createHash("sha256").update(REAL_TOKEN).digest("hex");

function setup() {
  const integrations = {
    runHealthSweep: vi.fn(async () => ({ connectionsProcessed: 5, connectionsFailed: 1 })),
  } as unknown as IntegrationService;
  const controller = new ConnectorHealthSweepController(integrations, TOKEN_HASH);
  return { integrations, controller };
}

describe("ConnectorHealthSweepController", () => {
  it("rejects a missing authorization header", async () => {
    const { controller } = setup();
    await expect(controller.runHealthSweep(undefined)).rejects.toThrow(HttpException);
  });

  it("rejects a wrong shared secret", async () => {
    const { controller } = setup();
    await expect(controller.runHealthSweep("Bearer wrong-token")).rejects.toThrow(HttpException);
  });

  it("accepts the real shared secret and relays to IntegrationService.runHealthSweep", async () => {
    const { controller, integrations } = setup();
    const result = await controller.runHealthSweep(`Bearer ${REAL_TOKEN}`);
    expect(integrations.runHealthSweep).toHaveBeenCalledWith("svc_platform_jobs");
    expect(result).toEqual({ connections_processed: 5, connections_failed: 1 });
  });
});
