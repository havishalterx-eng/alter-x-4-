import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import {
  Auth0M2mTokenProvider,
  lazyAuth0M2mTokenProviderFromEnvironment,
} from "./auth0-m2m-token-provider";
import { M2mValidator } from "./m2m-validator";
import { mintJwt, testSigningKey } from "../test-utils/jwt-fixture";

describe("Auth0M2mTokenProvider", () => {
  it("acquires then caches a client-credentials token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "signed-token", expires_in: 300 }), {
        status: 200,
      }),
    );
    const resolveClientSecret = vi.fn().mockResolvedValue("resolved-secret");
    const provider = new Auth0M2mTokenProvider({
      tokenUrl: "https://issuer.test/oauth/token",
      audience: "alter-engine",
      clientId: "orchestration-service",
      resolveClientSecret,
      fetchImpl,
      now: () => 1_000,
    });

    await expect(provider.getAccessToken()).resolves.toBe("signed-token");
    await expect(provider.getAccessToken()).resolves.toBe("signed-token");
    expect(resolveClientSecret).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      grant_type: "client_credentials",
      client_id: "orchestration-service",
      client_secret: "resolved-secret",
      audience: "alter-engine",
    });
  });

  it("fails closed for bad token responses", async () => {
    const provider = new Auth0M2mTokenProvider({
      tokenUrl: "https://issuer.test/oauth/token",
      audience: "alter-engine",
      clientId: "orchestration-service",
      resolveClientSecret: async () => "resolved-secret",
      fetchImpl: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    });
    await expect(provider.getAccessToken()).rejects.toThrow(
      "M2M token response failed validation",
    );
  });

  it("rejects a plain-HTTP token endpoint outside loopback", () => {
    expect(
      () =>
        new Auth0M2mTokenProvider({
          tokenUrl: "http://issuer.test/oauth/token",
          audience: "alter-engine",
          clientId: "orchestration-service",
          resolveClientSecret: async () => "resolved-secret",
        }),
    ).toThrow("Auth0 M2M token URL must use HTTPS outside loopback tests");
  });

  it("defers missing environment failure until an outbound token is requested", async () => {
    const provider = lazyAuth0M2mTokenProviderFromEnvironment({});

    await expect(provider.getAccessToken()).rejects.toThrow(
      "Missing required Auth0 M2M configuration: AUTH0_M2M_TOKEN_URL",
    );
  });

  it("acquires then validates a signed token through a real local JWKS issuer", async () => {
    const key = testSigningKey("local-m2m");
    const now = Math.floor(Date.now() / 1_000);
    const server = createServer((request, response) => {
      const port = (server.address() as AddressInfo).port;
      if (request.url === "/.well-known/jwks.json") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [key.jwk] }));
        return;
      }
      if (request.url === "/oauth/token" && request.method === "POST") {
        const token = mintJwt(
          {
            iss: `https://127.0.0.1:${port}/`,
            aud: "alter-engine",
            sub: "local-eval-caller",
            iat: now,
            exp: now + 300,
          },
          key,
        );
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ access_token: token, expires_in: 300 }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const provider = new Auth0M2mTokenProvider({
        tokenUrl: `http://127.0.0.1:${port}/oauth/token`,
        audience: "alter-engine",
        clientId: "local-eval-caller",
        resolveClientSecret: async () => "test-only-client-secret",
      });
      const validator = new M2mValidator({
        auth0Domain: `127.0.0.1:${port}`,
        apiAudience: "alter-engine",
        jwksUrl: `http://127.0.0.1:${port}/.well-known/jwks.json`,
      });

      await expect(validator.validate(`Bearer ${await provider.getAccessToken()}`)).resolves.toMatchObject({
        claims: { sub: "local-eval-caller" },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
