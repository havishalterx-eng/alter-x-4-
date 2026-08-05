import type { ProvisioningGrpcHandler } from "@alterx/adapters";
import type {
  ProvisioningCloseCycleRequest,
  ProvisioningCloseCycleResponse,
  ProvisioningProvisionRequest,
  ProvisioningProvisionResponse,
} from "@alterx/contracts";

import { ProvisioningService } from "./provisioning.service";

export class ProvisioningServiceGrpcHandler implements ProvisioningGrpcHandler {
  constructor(private readonly provisioning: ProvisioningService) {}

  async provision(
    request: ProvisioningProvisionRequest,
  ): Promise<ProvisioningProvisionResponse> {
    const result = await this.provisioning.provision({
      tenantId: request.tenant_id,
      runId: request.run_id,
      projectId: request.project_id,
      cycleId: request.cycle_id,
      templateId: request.template_id,
      // gRPC omits empty protobuf maps and repeated fields at runtime.
      environmentRefs: request.environment_refs ?? {},
      scaffold: request.scaffold ?? [],
    });
    return {
      session_id: result.sessionId,
      project_directory: result.projectDirectory,
      reused: result.reused,
    };
  }

  async closeCycle(
    request: ProvisioningCloseCycleRequest,
  ): Promise<ProvisioningCloseCycleResponse> {
    await this.provisioning.closeCycle(
      request.tenant_id,
      request.run_id,
      request.project_id,
      request.cycle_id,
    );
    return { closed: true };
  }
}
