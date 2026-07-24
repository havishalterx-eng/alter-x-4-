import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Pool } from "pg";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingExceptionFilter } from "./onboarding-exception.filter";
import {
  ONBOARDING_INITIALIZER,
  OnboardingRepository,
} from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";

@Module({
  controllers: [OnboardingController],
  providers: [
    {
      provide: OnboardingRepository,
      useFactory: () =>
        new OnboardingRepository(
          new Pool({ connectionString: process.env.DATABASE_URL }),
        ),
    },
    {
      provide: ONBOARDING_INITIALIZER,
      useExisting: OnboardingRepository,
    },
    {
      provide: OnboardingService,
      inject: [OnboardingRepository],
      useFactory: (repository: OnboardingRepository) =>
        new OnboardingService(repository),
    },
    {
      provide: APP_FILTER,
      useClass: OnboardingExceptionFilter,
    },
  ],
  exports: [ONBOARDING_INITIALIZER],
})
export class OnboardingModule {}
