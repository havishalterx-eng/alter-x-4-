import { Controller, Get } from "@nestjs/common";
import { Public } from "../rbac/decorators";
import { SystemHealthService, type SystemHealthResponse } from "./system-health.service";

@Controller("system")
@Public()
export class SystemHealthController {
  constructor(private readonly health: SystemHealthService) {}

  @Get("service-health")
  getServiceHealth(): Promise<SystemHealthResponse> {
    return this.health.getHealth();
  }
}
