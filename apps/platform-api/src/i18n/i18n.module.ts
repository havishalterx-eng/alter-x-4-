import { Module } from "@nestjs/common";
import { SignupModule } from "../signup/signup.module";
import { PlatformDb } from "../signup/platform-db";
import { I18nController } from "./i18n.controller";
import { I18nExceptionFilter } from "./i18n-exception.filter";
import { I18nService } from "./i18n.service";

@Module({
  imports: [SignupModule],
  controllers: [I18nController],
  providers: [
    {
      provide: I18nService,
      inject: [PlatformDb],
      useFactory: (db: PlatformDb) => new I18nService(db),
    },
    I18nExceptionFilter,
  ],
  exports: [I18nService],
})
export class I18nModule {}
