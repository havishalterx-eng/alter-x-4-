import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
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
  private readonly logger = new Logger(CredentialResumeController.name);

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
    @Headers("traceparent") traceparent: string | undefined,
  ): Promise<CredentialView> {
    const instance = `/api/v1/runs/${runId}/nodes/${nodeExecutionId}/credentials`;
    const resumeName = `resume-${nodeExecutionId}`;

    // A retry-signal failure below leaves a real, already-created
    // credential with no compensating delete (there is nothing wrong with
    // the credential itself -- only the signal failed) and no way to
    // report that back to a client that then retries this endpoint with a
    // fresh idempotency key. Without this check, every such retry created
    // another credential named identically, accumulating orphaned secrets
    // in the vault forever. Reuse the one already created for this node
    // instead of creating a duplicate.
    const existing = (await this.credentials.list(actor.tenant_id)).find(
      (credential) => credential.name === resumeName,
    );

    let credential: CredentialView;
    if (existing) {
      credential = existing;
    } else {
      const rawBody = body as Record<string, unknown>;
      const createBody = { ...rawBody, name: resumeName };
      const parsed = parseCreateCredential(createBody, instance);
      credential = await this.credentials.create(actor.tenant_id, parsed);
    }

    // Real running Temporal workflow signal.
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
          traceparent: traceparent ?? "",
        },
        { idempotencyKey: `retry-signal-${nodeExecutionId}` }
      );
    } catch (error: unknown) {
      // If signalling fails, the credential was still created (or reused
      // above), but the workflow isn't resumed. 502 tells the caller the
      // downstream signal failed; a retry now reuses the same credential
      // rather than creating another one.
      this.logger.error(
        `Failed to signal orchestration retry for run ${runId} node ${nodeExecutionId}`,
        error instanceof Error ? error.stack : String(error),
      );
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
