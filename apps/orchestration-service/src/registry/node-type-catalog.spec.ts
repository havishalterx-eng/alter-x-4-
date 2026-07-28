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

const IMPLEMENTED_TYPES = [
  "Gate",
  "Merge",
  "PubSub",
  "GroupChat",
  "YAMLImport",
  "LLMTask",
  "ToolCall",
  "SandboxExec",
];

describe("listNodeTypeDescriptors", () => {
  it("returns exactly the 11 Node Type Registry types", () => {
    const descriptors = listNodeTypeDescriptors();

    expect(descriptors.map((d) => d.type).sort()).toEqual([...ALL_11_TYPES].sort());
  });

  it("marks real handlers implemented while HumanApproval remains an explicit stub", () => {
    const descriptors = listNodeTypeDescriptors();

    const implemented = descriptors.filter((d) => d.handler_implemented).map((d) => d.type);
    expect(implemented.sort()).toEqual([...IMPLEMENTED_TYPES].sort());
  });

  it("publishes credential_ref as required ToolCall config", () => {
    const descriptor = findNodeTypeDescriptor("ToolCall");
    const schema = JSON.parse(descriptor?.config_schema_json ?? "{}") as {
      readonly properties?: Record<string, unknown>;
      readonly required?: readonly string[];
    };

    expect(schema.properties).toHaveProperty("credential_ref");
    expect(schema.required).toContain("credential_ref");
  });

  it("publishes Provisioning-owned session ID as required SandboxExec config", () => {
    const descriptor = findNodeTypeDescriptor("SandboxExec");
    const schema = JSON.parse(descriptor?.config_schema_json ?? "{}") as {
      readonly properties?: Record<string, unknown>;
      readonly required?: readonly string[];
    };

    expect(schema.properties).toHaveProperty("sandbox_session_id");
    expect(schema.required).toContain("sandbox_session_id");
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
