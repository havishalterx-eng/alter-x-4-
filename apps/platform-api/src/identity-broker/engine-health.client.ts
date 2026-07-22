import { Injectable } from "@nestjs/common";
import { IdentityBrokerService } from "./identity-broker.service";

export interface EngineHealthTransport {
  getHealth(headers: Record<string, string>): Promise<{ status: string }>;
}

@Injectable()
export class EngineHealthClient {
  constructor(
    private readonly identityBroker: IdentityBrokerService,
    private readonly transport: EngineHealthTransport,
  ) {}

  async getHealthWithActor(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    sessionId: string;
    authTime: number;
    roles: string[];
    permissions: string[];
    callingTenantId: string;
  }): Promise<{ status: string }> {
    const minted = await this.identityBroker.mintActorToken(input);

    return this.transport.getHealth({
      "X-Alter-Actor-Token": minted.token,
    });
  }
}
