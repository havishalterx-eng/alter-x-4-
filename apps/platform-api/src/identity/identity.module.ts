import { Module } from "@nestjs/common";
import pg from "pg";
import { Auth0IdentityProvider } from "./adapters/auth0/auth0-identity-provider";
import { MockIdentityProvider } from "./adapters/mock/mock-identity-provider";
import { IdentityController } from "./identity.controller";
import type { IdentityProvider } from "./identity-provider.interface";
import { IdentityService } from "./identity.service";
import { InMemorySessionStore, PgSessionStore, type SessionStore } from "./session-store";

const identityProviderToken = Symbol("IdentityProvider");
const sessionStoreToken = Symbol("SessionStore");

@Module({
  controllers: [IdentityController],
  providers: [
    {
      provide: identityProviderToken,
      useFactory: (): IdentityProvider => {
        if (
          process.env.IDENTITY_PROVIDER === "auth0" &&
          process.env.AUTH0_DOMAIN &&
          process.env.AUTH0_CLIENT_ID
        ) {
          return new Auth0IdentityProvider({
            domain: process.env.AUTH0_DOMAIN,
            clientId: process.env.AUTH0_CLIENT_ID,
          });
        }

        return new MockIdentityProvider();
      },
    },
    {
      provide: sessionStoreToken,
      useFactory: (): SessionStore => {
        if (process.env.DATABASE_URL) {
          return new PgSessionStore(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
        }

        return new InMemorySessionStore();
      },
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
