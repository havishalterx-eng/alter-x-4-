import { Controller, Get } from "@nestjs/common";
import { Public } from "@alterx/auth";
@Controller("health") export class HealthController { @Get() @Public() getHealth(): { status: "ok"; service: "provisioning-service" } { return { status: "ok", service: "provisioning-service" }; } }
