import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { Pool } from "pg";
import { StaffController } from "./staff.controller";
import { StaffAuthMiddleware } from "./staff.middleware";
import { StaffRepository } from "./staff.repository";
import { StaffService } from "./staff.service";
import { SupportAccessController } from "./support-access.controller";
import { SupportAccessExceptionFilter } from "./support-access-exception.filter";

@Module({
  controllers: [StaffController, SupportAccessController],
  providers: [
    {
      provide: StaffRepository,
      useFactory: () => new StaffRepository(new Pool({ connectionString: process.env.DATABASE_URL })),
    },
    StaffService,
    StaffAuthMiddleware,
    SupportAccessExceptionFilter,
  ],
})
export class StaffModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(StaffAuthMiddleware).forRoutes(StaffController);
  }
}
