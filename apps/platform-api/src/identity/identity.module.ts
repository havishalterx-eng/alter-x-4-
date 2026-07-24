import { Module } from "@nestjs/common";
import pg from "pg";
import {
  Auth0IdentityProvider,
  type Auth0IdentityProviderOptions,
} from "./adapters/auth0/auth0-identity-provider";
import { MockIdentityProvider } from "./adapters/mock/mock-identity-provider";
import { IdentityController } from "./identity.controller";
import type { IdentityProvider } from "./identity-provider.interface";
import { IdentityService } from "./identity.service";
import { InMemorySessionStore, PgSessionStore, type SessionStore } from "./session-store";
import {
  InMemorySsoConfigStore,
  PgSsoConfigStore,
  type SsoConfigStore,
} from "./sso-config-store";

const identityProviderToken = Symbol("IdentityProvider");
const sessionStoreToken = Symbol("SessionStore");
const ssoConfigStoreToken = Symbol("SsoConfigStore");
const databasePoolToken = Symbol("DatabasePool");

@Module({
  controllers: [IdentityController],
  providers: [
    {
      provide: databasePoolToken,
      useFactory: (): pg.Pool | undefined =>
        process.env.DATABASE_URL
          ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
          : undefined,
    },
    {
      provide: sessionStoreToken,
      useFactory: (pool: pg.Pool | undefined): SessionStore =>
        pool ? new PgSessionStore(pool) : new InMemorySessionStore(),
      inject: [databasePoolToken],
    },
    {
      provide: ssoConfigStoreToken,
      useFactory: (pool: pg.Pool | undefined): SsoConfigStore =>
        pool ? new PgSsoConfigStore(pool) : new InMemorySsoConfigStore(),
      inject: [databasePoolToken],
    },
    {
      provide: identityProviderToken,
      useFactory: (
        sessionStore: SessionStore,
        ssoConfigStore: SsoConfigStore,
      ): IdentityProvider => {
        if (
          process.env.IDENTITY_PROVIDER === "auth0" &&
          process.env.AUTH0_DOMAIN &&
          process.env.AUTH0_CLIENT_ID
        ) {
          const options: Auth0IdentityProviderOptions = {
            domain: process.env.AUTH0_DOMAIN,
            clientId: process.env.AUTH0_CLIENT_ID,
            resolveSecret: resolveRuntimeSecret,
          };
          if (process.env.AUTH0_CLIENT_SECRET_REF) {
            options.clientSecretRef = process.env.AUTH0_CLIENT_SECRET_REF;
          }
          if (process.env.AUTH0_M2M_CLIENT_ID) {
            options.m2mClientId = process.env.AUTH0_M2M_CLIENT_ID;
          }
          if (process.env.AUTH0_M2M_CLIENT_SECRET_REF) {
            options.m2mClientSecretRef = process.env.AUTH0_M2M_CLIENT_SECRET_REF;
          }
          return new Auth0IdentityProvider(options, sessionStore, ssoConfigStore);
        }

        return new MockIdentityProvider(sessionStore, ssoConfigStore);
      },
      inject: [sessionStoreToken, ssoConfigStoreToken],
    },
    {
      provide: IdentityService,
      useFactory: (identityProvider: IdentityProvider, sessionStore: SessionStore) =>
        new IdentityService(identityProvider, sessionStore),
      inject: [identityProviderToken, sessionStoreToken],
    },
  ],
})
export class IdentityModule {}

export async function resolveRuntimeSecret(reference: string): Promise<string> {
  const environmentKey = reference.startsWith("env:")
    ? reference.slice("env:".length)
    : reference;
  const value = process.env[environmentKey];
  if (!value) {
    throw new Error(`Secret reference unavailable: ${reference}`);
  }
  return value;
}
