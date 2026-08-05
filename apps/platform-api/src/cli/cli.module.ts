import { Module } from "@nestjs/common";
import { IDENTITY_PROVIDER, IdentityModule } from "../identity/identity.module";
import type { IdentityProvider } from "../identity/identity-provider.interface";
import { CLI_CONFIG_PROVIDER, cliConfigProviderFromEnvironment, type CliConfigProvider } from "./cli-config";
import { CliController } from "./cli.controller";
import { CliRateLimiter } from "./cli-rate-limiter";
import { CliService } from "./cli.service";

@Module({
  imports: [IdentityModule],
  controllers: [CliController],
  providers: [
    { provide: CLI_CONFIG_PROVIDER, useFactory: cliConfigProviderFromEnvironment },
    {
      provide: CliService,
      inject: [IDENTITY_PROVIDER, CLI_CONFIG_PROVIDER],
      useFactory: (identity: IdentityProvider, config: CliConfigProvider) => new CliService(identity, config),
    },
    {
      provide: CliRateLimiter,
      inject: [CLI_CONFIG_PROVIDER],
      useFactory: (config: CliConfigProvider) => new CliRateLimiter(config),
    },
  ],
})
export class CliModule {}
