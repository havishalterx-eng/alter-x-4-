import { describe, expect, it } from "vitest";

import { createMockDeploymentProvider } from "./deployment-provider";

describe("createMockDeploymentProvider", () => {
  it("records artifact deployments and returns a traceable reference", async () => {
    const provider = createMockDeploymentProvider();
    const result = await provider.deployArtifact({
      tenantId: "ten_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
      projectId: "prj_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaab",
      artifactId: "art_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac",
      sourceReference: "s3://artifact-bucket/tenants/tenant/runs/run/artifacts/artifact",
      contentType: "text/html",
    });

    expect(result.deploymentReference).toContain("art_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac");
    expect(provider.requests).toHaveLength(1);
  });
});
