import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Pool } from "pg";
import { CONFIG_PROVIDER, type ConfigProvider } from "./config-provider.interface";
import { AppConfigConfigProvider } from "./adapters/appconfig/appconfig-config-provider";
import { LocalFileConfigProvider } from "./adapters/local-file/local-file-config-provider";
import { ENTITLEMENT_PROVIDER } from "./entitlement-provider.interface";
import { PostgresEntitlementStore } from "./entitlement-store";
import { InternalEntitlementProvider } from "./internal-entitlement-provider";
import { EntitlementAccessGuard } from "./entitlement-access.guard";
import { EntitlementsController } from "./entitlements.controller";

const ENTITLEMENT_STORE = Symbol("ENTITLEMENT_STORE");

@Module({
  controllers: [EntitlementsController],
  providers: [
    {
      provide: CONFIG_PROVIDER,
      useFactory: (): ConfigProvider => {
        if (process.env.ALTER_CONFIG_SOURCE === "appconfig") {
          return new AppConfigConfigProvider({
            applicationIdentifier: process.env.APPCONFIG_APP_ID!,
            environmentIdentifier: process.env.APPCONFIG_ENV_ID!,
            configurationProfileIdentifier: process.env.APPCONFIG_PROFILE_ID!,
          });
        }
        return new LocalFileConfigProvider();
      },
    },
    {
      provide: ENTITLEMENT_STORE,
      useFactory: () =>
        new PostgresEntitlementStore(
          new Pool({ connectionString: process.env.DATABASE_URL }),
        ),
    },
    {
      provide: ENTITLEMENT_PROVIDER,
      inject: [ENTITLEMENT_STORE, CONFIG_PROVIDER],
      useFactory: (
        store: ConstructorParameters<typeof InternalEntitlementProvider>[0],
        configProvider: ConfigProvider,
      ) => new InternalEntitlementProvider(store, configProvider),
    },
    {
      provide: APP_GUARD,
      useClass: EntitlementAccessGuard,
    },
  ],
  exports: [CONFIG_PROVIDER, ENTITLEMENT_PROVIDER],
})
export class EntitlementsModule {}
