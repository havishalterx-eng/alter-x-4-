import { Controller, Get } from "@nestjs/common";
import { Public } from "@alterx/auth";

export interface HealthResponse {
  status: "ok";
  service: "model-gateway";
}

@Controller("health")
export class HealthController {
  @Get()
  @Public()
  getHealth(): HealthResponse {
    return { status: "ok", service: "model-gateway" };
  }
}
