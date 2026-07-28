import { describe, expect, it } from "vitest";

import { RegistryNotFoundError, RegistryService, RegistryValidationError } from "./registry.service";

describe("RegistryService.listNodeTypes", () => {
  it("returns all 11 node types", async () => {
    const service = new RegistryService();

    const response = await service.listNodeTypes({});

    expect(response.node_types).toHaveLength(11);
  });
});

describe("RegistryService.getNodeType", () => {
  it("returns the descriptor for a known type", async () => {
    const service = new RegistryService();

    const response = await service.getNodeType({ type: "Merge" });

    expect(response.node_type?.type).toBe("Merge");
    expect(response.node_type?.handler_implemented).toBe(true);
  });

  it("rejects a blank type", async () => {
    const service = new RegistryService();

    await expect(service.getNodeType({ type: "  " })).rejects.toThrow(
      RegistryValidationError,
    );
  });

  it("reports not found for an unknown type", async () => {
    const service = new RegistryService();

    await expect(service.getNodeType({ type: "NotAType" })).rejects.toThrow(
      RegistryNotFoundError,
    );
  });
});
