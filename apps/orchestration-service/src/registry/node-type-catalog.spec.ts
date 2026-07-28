import { describe, expect, it } from "vitest";

import { findNodeTypeDescriptor, listNodeTypeDescriptors } from "./node-type-catalog";

const ALL_11_TYPES = [
  "LLMTask",
  "ToolCall",
  "SandboxExec",
  "Gate",
  "HumanApproval",
  "Merge",
  "Synthesis",
  "MemoryWrite",
  "PubSub",
  "GroupChat",
  "YAMLImport",
];

const EXEC1_IMPLEMENTED_TYPES = ["Gate", "Merge", "PubSub", "GroupChat", "YAMLImport"];

describe("listNodeTypeDescriptors", () => {
  it("returns exactly the 11 Node Type Registry types", () => {
    const descriptors = listNodeTypeDescriptors();

    expect(descriptors.map((d) => d.type).sort()).toEqual([...ALL_11_TYPES].sort());
  });

  it("marks exactly the 5 EXEC-1 handlers as implemented", () => {
    const descriptors = listNodeTypeDescriptors();

    const implemented = descriptors.filter((d) => d.handler_implemented).map((d) => d.type);
    expect(implemented.sort()).toEqual([...EXEC1_IMPLEMENTED_TYPES].sort());
  });

  it("every descriptor has non-empty display_name/description/category", () => {
    for (const descriptor of listNodeTypeDescriptors()) {
      expect(descriptor.display_name.length).toBeGreaterThan(0);
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor.category.length).toBeGreaterThan(0);
    }
  });

  it("every descriptor's config_schema_json is valid JSON", () => {
    for (const descriptor of listNodeTypeDescriptors()) {
      expect(() => JSON.parse(descriptor.config_schema_json)).not.toThrow();
    }
  });
});

describe("findNodeTypeDescriptor", () => {
  it("finds a known type", () => {
    expect(findNodeTypeDescriptor("Gate")?.type).toBe("Gate");
  });

  it("returns undefined for an unknown type", () => {
    expect(findNodeTypeDescriptor("NotAType")).toBeUndefined();
  });
});
