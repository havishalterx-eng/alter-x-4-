import { createHash, timingSafeEqual } from "node:crypto";
import { Controller, Headers, HttpException, Inject, Post } from "@nestjs/common";
import { Public } from "../rbac/decorators";
import { IntegrationService } from "./integration.service";

export const CONNECTOR_HEALTH_SWEEP_SERVICE_TOKEN_HASH = Symbol(
  "CONNECTOR_HEALTH_SWEEP_SERVICE_TOKEN_HASH",
);

const SWEEP_ACTOR_ID = "svc_platform_jobs";

/**
 * Internal-only, service-token authenticated -- same real trust boundary
 * and pattern as notifications' NotificationDigestSchedulerController.
 * @Public() bypasses the normal per-actor RBAC guard (there is no real
 * user actor for a service-to-service call); authorize() below is the
 * real security boundary in its place. Only background-workers' Platform
 * Jobs worker should ever hold this shared secret.
 */
@Controller("internal/integrations")
export class ConnectorHealthSweepController {
  constructor(
    private readonly integrations: IntegrationService,
    @Inject(CONNECTOR_HEALTH_SWEEP_SERVICE_TOKEN_HASH)
    private readonly tokenHash: string,
  ) {}

  private authorize(value: string | undefined): void {
    const token = value?.startsWith("Bearer ") ? value.slice(7) : "";
    const actual = createHash("sha256").update(token).digest();
    const expected = Buffer.from(this.tokenHash, "hex");
    if (!token || expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      throw new HttpException(
        {
          type: "https://alter.dev/problems/unauthorized",
          title: "Unauthorized",
          status: 401,
          instance: "/internal/integrations/run-health-sweep",
        },
        401,
      );
    }
  }

  @Public()
  @Post("run-health-sweep")
  async runHealthSweep(@Headers("authorization") auth?: string) {
    this.authorize(auth);
    const result = await this.integrations.runHealthSweep(SWEEP_ACTOR_ID);
    return {
      connections_processed: result.connectionsProcessed,
      connections_failed: result.connectionsFailed,
    };
  }
}
