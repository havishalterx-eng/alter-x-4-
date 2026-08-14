import { Controller, Get } from "@nestjs/common";
import { Public } from "../rbac/decorators";
import { IdentityBrokerService } from "./identity-broker.service";

@Controller()
export class IdentityBrokerJwksController {
  constructor(private readonly identityBroker: IdentityBrokerService) {}

  @Public()
  @Get("/.well-known/actor-jwks.json")
  async jwks(): Promise<{ keys: Record<string, unknown>[] }> {
    return this.identityBroker.publicJwks();
  }
}
