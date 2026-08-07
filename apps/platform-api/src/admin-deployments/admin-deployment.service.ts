import { Injectable } from "@nestjs/common";
import type {
  DeploymentAdminActionRequest,
  DeploymentAdminActionResult,
} from "@alterx/contracts";
import { AdminAuditService } from "../admin-audit";
import { DeploymentAdminClient } from "../engine";

@Injectable()
export class AdminDeploymentService {
  constructor(
    private readonly client: DeploymentAdminClient,
    private readonly audit: AdminAuditService,
  ) {}

  async apply(
    input: DeploymentAdminActionRequest,
    staffUserId: string,
    traceparent: string | undefined,
  ): Promise<DeploymentAdminActionResult> {
    const result = await this.client.apply(input, traceparent);
    await this.audit.record({
      tenantId: input.tenant_id,
      actorType: "admin",
      actorRef: staffUserId,
      action: `deployment.${input.action}`,
      targetType: "deployment",
      targetRef: input.deployment_id,
      reasonCode: input.reason,
      scope: "deployments:write",
    });
    return result;
  }
}
