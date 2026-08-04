import { describe, expect, it } from "vitest";
import { parseCreateManifest, parseCreateVersion } from "./validation";
describe("registry validation", () => {
  it("validates manifest ecosystem", () => { expect(parseCreateManifest({ name: "Tool", ecosystem: "mcp", trust_level: "community_reviewed" }, "/registry").ecosystem).toBe("mcp"); try { parseCreateManifest({ name: "Tool", ecosystem: "go", trust_level: "community_reviewed" }, "/registry"); } catch (error) { expect((error as { getResponse(): { error_code: string } }).getResponse().error_code).toBe("INVALID_REGISTRY_REQUEST"); } });
  it("validates semantic versions and declarations", () => { expect(parseCreateVersion({ version: "1.2.3", artifact_ref: "s3://bucket/tool.tgz", capabilities: ["search"], permissions: ["network:read"] }, "/registry").version).toBe("1.2.3"); try { parseCreateVersion({ version: "nope", artifact_ref: "x", capabilities: [], permissions: [] }, "/registry"); } catch (error) { expect((error as { getResponse(): { error_code: string } }).getResponse().error_code).toBe("INVALID_REGISTRY_REQUEST"); } });
});
