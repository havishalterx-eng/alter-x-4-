import { describe, expect, it } from "vitest";

import { NodeHandlerValidationError } from "../handler";
import { YamlImportHandler } from "./yaml-import.handler";

describe("YamlImportHandler", () => {
  it("has nodeType YAMLImport", () => {
    expect(new YamlImportHandler().nodeType).toBe("YAMLImport");
  });

  it("parses a YAML object into output", async () => {
    const handler = new YamlImportHandler();

    const result = await handler.execute({
      config: { yaml: "name: alter\nversion: 1\nnested:\n  a: true" },
      inputs: {},
    });

    expect(result.output).toEqual({ name: "alter", version: 1, nested: { a: true } });
  });

  it("rejects a missing config.yaml", async () => {
    const handler = new YamlImportHandler();

    await expect(
      handler.execute({ config: {}, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects invalid YAML syntax", async () => {
    const handler = new YamlImportHandler();

    await expect(
      handler.execute({ config: { yaml: "a: [unterminated" }, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects YAML that parses to a scalar", async () => {
    const handler = new YamlImportHandler();

    await expect(
      handler.execute({ config: { yaml: "just a string" }, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects YAML that parses to an array", async () => {
    const handler = new YamlImportHandler();

    await expect(
      handler.execute({ config: { yaml: "- a\n- b" }, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });
});
