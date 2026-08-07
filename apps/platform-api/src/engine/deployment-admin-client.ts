import { Injectable } from "@nestjs/common";
import {
  DeploymentAdminActionResultSchema,
  type DeploymentAdminActionRequest,
  type DeploymentAdminActionResult,
} from "@alterx/contracts";
import type { EngineConfig } from "./config";
import { EngineProblemError, engineProblemFromResponse, upstreamProblem } from "./problem";
import type { EvalFacadeSecretResolver } from "./eval-facade-client";

@Injectable()
export class DeploymentAdminClient {
  constructor(
    private readonly config: EngineConfig,
    private readonly resolveSecret: EvalFacadeSecretResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async apply(
    input: DeploymentAdminActionRequest,
    traceparent: string | undefined,
  ): Promise<DeploymentAdminActionResult> {
    const instance = `/api/v1/admin/deployments/${input.deployment_id}/actions/apply`;
    let token: string;
    try {
      token = await this.resolveSecret(this.config.deploymentAdminServiceTokenRef);
    } catch {
      throw new EngineProblemError(upstreamProblem(502, instance, "UPSTREAM_SERVICE_ERROR"));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/internal/admin/deployments/actions/apply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json, application/problem+json",
          "content-type": "application/json",
          ...(traceparent ? { traceparent } : {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (response.status === 401) {
        throw new EngineProblemError(upstreamProblem(502, instance, "UPSTREAM_SERVICE_ERROR"));
      }
      if (!response.ok) throw new EngineProblemError(await engineProblemFromResponse(response, instance));
      const parsed = DeploymentAdminActionResultSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new EngineProblemError(upstreamProblem(502, instance, "UPSTREAM_SERVICE_ERROR"));
      }
      return parsed.data;
    } catch (error: unknown) {
      if (error instanceof EngineProblemError) throw error;
      throw new EngineProblemError(
        upstreamProblem(error instanceof Error && error.name === "AbortError" ? 504 : 502, instance,
          error instanceof Error && error.name === "AbortError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_SERVICE_ERROR"),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
