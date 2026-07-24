import { describe, expect, it } from "vitest";

import { HealthController, type HealthResponse } from "./health.controller";

describe("HealthController", () => {
  it("returns the service health response", () => {
    const response: HealthResponse = new HealthController().getHealth();

    expect(response).toEqual({
      status: "ok",
      service: "model-gateway",
    });
  });
});
