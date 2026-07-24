import { Controller, Get } from "@nestjs/common";
import { Public } from "../rbac/decorators";

export interface HealthResponse {
  status: "ok";
  service: "platform-api";
}

@Controller("health")
@Public()
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: "ok", service: "platform-api" };
  }
}
