import { Module } from "@nestjs/common";
import {
  FetchServiceHealthTransport,
  type ServiceHealthTransport,
} from "../engine/service-health-transport";
import { SystemHealthController } from "./system-health.controller";
import { systemHealthConfigFromEnvironment } from "./system-health.config";
import { SystemHealthService } from "./system-health.service";

const SYSTEM_HEALTH_CONFIG = Symbol("SYSTEM_HEALTH_CONFIG");
const SYSTEM_HEALTH_TRANSPORT = Symbol("SYSTEM_HEALTH_TRANSPORT");

@Module({
  controllers: [SystemHealthController],
  providers: [
    {
      provide: SYSTEM_HEALTH_CONFIG,
      useFactory: () => systemHealthConfigFromEnvironment(process.env),
    },
    {
      provide: SYSTEM_HEALTH_TRANSPORT,
      useClass: FetchServiceHealthTransport,
    },
    {
      provide: SystemHealthService,
      inject: [SYSTEM_HEALTH_CONFIG, SYSTEM_HEALTH_TRANSPORT],
      useFactory: (
        config: ReturnType<typeof systemHealthConfigFromEnvironment>,
        transport: ServiceHealthTransport,
      ) => new SystemHealthService(config, transport),
    },
  ],
})
export class SystemHealthModule {}
