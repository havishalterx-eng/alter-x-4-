import { describe, expect, it } from "vitest";
import { createInMemoryPackageScanProvider } from "./package-scan";
const request = { tenantId: "ten_1", manifestId: "tlm_00000000-0000-7000-8000-000000000001", manifestVersion: "1.0.0", artifactRef: "s3://package/critical.tgz", ecosystem: "npm" as const };
describe("createInMemoryPackageScanProvider", () => {
  it("reports unavailable, not blocked, without a seeded report", async () => { expect((await createInMemoryPackageScanProvider().scanPackage(request)).verdict).toBe("unavailable"); });
  it("reports clean for an explicitly seeded empty findings list", async () => { const provider = createInMemoryPackageScanProvider(new Map([[request.artifactRef, []]])); expect((await provider.scanPackage(request)).verdict).toBe("clean"); });
  it("returns seeded critical finding", async () => { const provider = createInMemoryPackageScanProvider(new Map([[request.artifactRef, [{ rule: "malware", severity: "critical" as const, locator: "index.js", detail: "fixture" }]]])); expect(await provider.scanPackage(request)).toMatchObject({ verdict: "findings", findings: [{ severity: "critical" }] }); });
});
