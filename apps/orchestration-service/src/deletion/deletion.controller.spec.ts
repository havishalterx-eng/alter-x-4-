import { createHash } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { ProblemDetailsSchema } from "@alterx/contracts";
import { describe, expect, it, vi } from "vitest";

import { DeletionController } from "./deletion.controller";
import type { OrchestrationDeletionService } from "./deletion.service";

const TOKEN = "internal-service-token";
const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890a1";

describe("DeletionController internal authentication", () => {
  it("rejects missing or invalid service credentials before subject enumeration", () => {
    const listSubjectIds = vi.fn();
    const controller = controllerWith({ listSubjectIds });
    for (const authorization of [undefined, "Bearer wrong"]) {
      try {
        controller.subjects(authorization);
        throw new Error("expected authentication failure");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HttpException);
        const response = ProblemDetailsSchema.parse((error as HttpException).getResponse());
        expect(response).toMatchObject({ status: 401, error_code: "DELETION_AUTHENTICATION_FAILED" });
        expect(JSON.stringify(response)).not.toContain(TENANT);
      }
    }
    expect(listSubjectIds).not.toHaveBeenCalled();
  });

  it("returns raw subject IDs transiently on the internal authenticated route without logging", async () => {
    const listSubjectIds = vi.fn().mockResolvedValue([TENANT]);
    const controller = controllerWith({ listSubjectIds });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(controller.subjects(`Bearer ${TOKEN}`)).resolves.toEqual([TENANT]);
    expect(Reflect.getMetadata("path", DeletionController)).toBe("internal/deletion");
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

function controllerWith(
  methods: Partial<OrchestrationDeletionService>,
): DeletionController {
  return new DeletionController(
    methods as OrchestrationDeletionService,
    createHash("sha256").update(TOKEN).digest("hex"),
  );
}
