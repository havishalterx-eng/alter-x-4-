import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseFilters,
} from "@nestjs/common";
import { Idempotent } from "../idempotency";
import {
  ActorContext,
  RequireTenantRole,
  type ActorContextType,
} from "../rbac";
import { CredentialExceptionFilter } from "./credential-exception.filter";
import { CredentialService } from "./credential.service";
import type { CredentialView } from "./types";
import { parseCreateCredential } from "./validation";
import { EngineClient } from "../engine/engine-client";
import { CredentialHttpError } from "./problem";

@Controller("/api/v1/runs/:runId/nodes/:nodeExecutionId/credentials")
@UseFilters(CredentialExceptionFilter)
export class CredentialResumeController {
  constructor(
    private readonly credentials: CredentialService,
    private readonly engineClient: EngineClient,
  ) {}

  @Post()
  @HttpCode(201)
  @RequireTenantRole("admin", "owner")
  @Idempotent()
  async resume(
    @Param("runId") runId: string,
    @Param("nodeExecutionId") nodeExecutionId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ): Promise<CredentialView> {
    const instance = `/api/v1/runs/${runId}/nodes/${nodeExecutionId}/credentials`;

    // 1. Validate the incoming body against CreateCredential logic but with a specific name.
    const rawBody = body as Record<string, unknown>;
    const createBody = {
      ...rawBody,
      name: `resume-${nodeExecutionId}`, // Auto-generated name for resumed credentials
    };
    const parsed = parseCreateCredential(createBody, instance);

    // 2. Store the credential via the exact real path.
    const credential = await this.credentials.create(actor.tenant_id, parsed);

    // 3. Signal the real running Temporal workflow with nodeRetryDecidedSignal.
    try {
      await this.engineClient.post(
        `/api/v1/runs/${runId}/actions/retry-signal`,
        { node_execution_id: nodeExecutionId },
        {
          userId: actor.user_id,
          tenantId: actor.tenant_id,
          workspaceId: actor.workspace_id ?? "",
          sessionId: actor.session_id,
          authTime: actor.auth_time ?? 0,
          roles: actor.roles,
          permissions: actor.permissions,
          traceparent: "",
        },
        { idempotencyKey: `retry-signal-${nodeExecutionId}` }
      );
    } catch (error: unknown) {
      // If signalling fails, the credential was still created, but the workflow isn't resumed.
      // We throw a 502 Bad Gateway to indicate the downstream signal failed.
      console.error("ORCHESTRATION ERROR", error);
      throw new CredentialHttpError(
        502,
        "ORCHESTRATION_SIGNAL_FAILED",
        "Credential was saved, but failed to signal the orchestration service.",
        instance,
        [{ field: "orchestration", message: error instanceof Error ? error.message : "Unknown error" }],
      );
    }

    return credential;
  }
}
