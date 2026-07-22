import { Controller, Get } from "@nestjs/common";

export interface HealthResponse {
  status: "ok";
  service: "background-workers";
}

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: "ok", service: "background-workers" };
  }
}
