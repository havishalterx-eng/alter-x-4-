import { Controller, Get } from "@nestjs/common";

export interface HealthResponse {
  status: "ok";
  service: "orchestration-service";
}

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: "ok", service: "orchestration-service" };
  }
}
