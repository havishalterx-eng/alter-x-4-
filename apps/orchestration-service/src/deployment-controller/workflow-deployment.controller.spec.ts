import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  DeploymentNotFoundError,
  type DeploymentControllerService,
} from "./deployment-controller.service";
import { WorkflowDeploymentController } from "./workflow-deployment.controller";

const tenantId = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const workflowId = "wf_018f47a5-7b2c-7d10-8f11-123456789abc";
const workflowVersionId = "wfv_018f47a5-7b2c-7d10-8f11-123456789abc";

describe("WorkflowDeploymentController", () => {
  it("maps Platform workflow bodies to real Deployment Controller calls", async () => {
    const deployments = service();
    const controller = new WorkflowDeploymentController(deployments.value);
    const request = authenticatedRequest();

    await controller.promote(request as never, workflowId, { workflowVersionId });
    await controller.startCanary(request as never, workflowId, {
      workflowVersionId,
      trafficPercent: 10,
    });
    await controller.rollback(request as never, workflowId, { workflowVersionId });

    expect(deployments.promoteVersion).toHaveBeenCalledWith({
      tenant_id: tenantId,
      workflow_id: workflowId,
      workflow_version_id: workflowVersionId,
    });
    expect(deployments.startCanary).toHaveBeenCalledWith({
      tenant_id: tenantId,
      workflow_id: workflowId,
      workflow_version_id: workflowVersionId,
      traffic_percent: 10,
    });
    expect(deployments.rollbackVersion).toHaveBeenCalledWith({
      tenant_id: tenantId,
      workflow_id: workflowId,
      target_version_id: workflowVersionId,
    });
  });

  it("returns Problem Details for invalid input and real service failures", async () => {
    const controller = new WorkflowDeploymentController(service().value);

    await expect(
      controller.promote(authenticatedRequest() as never, workflowId, {}),
    ).rejects.toMatchObject({
      status: 400,
      response: { error_code: "WORKFLOW_DEPLOYMENT_VALIDATION_FAILED" },
    });

    const failed = service();
    failed.promoteVersion.mockRejectedValueOnce(
      new DeploymentNotFoundError(workflowId),
    );
    await expect(
      new WorkflowDeploymentController(failed.value).promote(
        authenticatedRequest() as never,
        workflowId,
        { workflowVersionId },
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { error_code: "WORKFLOW_DEPLOYMENT_NOT_FOUND" },
    });
  });

  it("rejects missing authenticated tenant context", async () => {
    const controller = new WorkflowDeploymentController(service().value);
    await expect(
      controller.promote({ url: "/api/v1/workflows/x" } as never, workflowId, {
        workflowVersionId,
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

function authenticatedRequest() {
  return {
    url: `/api/v1/workflows/${workflowId}/actions/promote-version`,
    actorContext: { tenant_id: tenantId },
  };
}

function service(): {
  value: DeploymentControllerService;
  promoteVersion: ReturnType<typeof vi.fn>;
  startCanary: ReturnType<typeof vi.fn>;
  rollbackVersion: ReturnType<typeof vi.fn>;
} {
  const promoteVersion = vi.fn().mockResolvedValue({ version_id: workflowVersionId });
  const startCanary = vi.fn().mockResolvedValue({ version_id: workflowVersionId });
  const rollbackVersion = vi.fn().mockResolvedValue({ version_id: workflowVersionId });
  return {
    value: {
      promoteVersion,
      startCanary,
      rollbackVersion,
    } as unknown as DeploymentControllerService,
    promoteVersion,
    startCanary,
    rollbackVersion,
  };
}
