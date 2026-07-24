import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { IdentityBrokerService } from "../identity-broker/identity-broker.service";
import type { EngineAuthorization, EngineCallerContext } from "./types";

export const ENGINE_M2M_TOKEN_PROVIDER = Symbol("ENGINE_M2M_TOKEN_PROVIDER");
export const ENGINE_AUTH_PROVIDER = Symbol("ENGINE_AUTH_PROVIDER");

export interface EngineM2mTokenProvider {
  getAccessToken(tenantId: string): Promise<string>;
}

export interface EngineAuthProvider {
  authorize(context: EngineCallerContext): Promise<EngineAuthorization>;
}

interface Auth0EngineM2mOptions {
  tokenUrl: string;
  audience: string;
  clientId: string;
  clientSecretRef: string;
  resolveSecret(reference: string): Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().min(1).optional(),
});

@Injectable()
export class Auth0EngineM2mTokenProvider implements EngineM2mTokenProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<
    string,
    { accessToken: string; expiresAt: number }
  >();

  constructor(private readonly options: Auth0EngineM2mOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getAccessToken(tenantId: string): Promise<string> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.now() + 60_000) {
      return cached.accessToken;
    }

    const clientSecret = await this.options.resolveSecret(
      this.options.clientSecretRef,
    );
    const response = await this.fetchImpl(this.options.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.options.clientId,
        client_secret: clientSecret,
        audience: this.options.audience,
        organization: tenantId,
      }),
    });

    if (!response.ok) {
      throw new Error(`M2M token request failed with status ${response.status}`);
    }

    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("M2M token response failed validation");
    }

    this.cache.set(tenantId, {
      accessToken: parsed.data.access_token,
      expiresAt: this.now() + parsed.data.expires_in * 1_000,
    });
    return parsed.data.access_token;
  }
}

@Injectable()
export class IdentityBrokerEngineAuthProvider implements EngineAuthProvider {
  constructor(
    private readonly identityBroker: IdentityBrokerService,
    @Inject(ENGINE_M2M_TOKEN_PROVIDER)
    private readonly m2mTokenProvider: EngineM2mTokenProvider,
  ) {}

  async authorize(
    context: EngineCallerContext,
  ): Promise<EngineAuthorization> {
    const [m2mAccessToken, actor] = await Promise.all([
      this.m2mTokenProvider.getAccessToken(context.tenantId),
      this.identityBroker.mintActorToken({
        userId: context.userId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        authTime: context.authTime,
        roles: context.roles,
        permissions: context.permissions,
        callingTenantId: context.tenantId,
      }),
    ]);

    return { m2mAccessToken, actorToken: actor.token };
  }
}
