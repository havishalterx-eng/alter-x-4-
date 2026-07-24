import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  jwksFetch,
  mintJwt,
  TEST_NOW,
  TEST_TENANT,
  TEST_WORKSPACE,
  testSigningKey,
  type TestSigningKey,
} from "../test-utils/jwt-fixture";
import {
  M2M_CLOCK_SKEW_SECONDS,
  M2mValidator,
} from "./m2m-validator";

const issuer = "https://tenant.auth0.com/";
const audience = "https://engine.alter.dev";
let key: TestSigningKey;

beforeAll(() => {
  key = testSigningKey();
});

function validator(signingKey = key) {
  return new M2mValidator(
    {
      auth0Domain: "tenant.auth0.com",
      apiAudience: audience,
    },
    { fetch: jwksFetch(signingKey), nowSeconds: () => TEST_NOW },
  );
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: issuer,
    aud: audience,
    exp: TEST_NOW + 60,
    iat: TEST_NOW,
    sub: "client-id",
    ...overrides,
  };
}

describe("M2mValidator", () => {
  it("fails fast on incomplete configuration", () => {
    expect(
      () => new M2mValidator({ auth0Domain: "", apiAudience: audience }),
    ).toThrow("configuration is incomplete");
    expect(
      () =>
        new M2mValidator({
          auth0Domain: "https://tenant.auth0.com/",
          apiAudience: " ",
        }),
    ).toThrow("configuration is incomplete");
  });

  it("accepts a valid Auth0 machine token", async () => {
    const result = await validator().validate(`Bearer ${mintJwt(claims(), key)}`);
    expect(result.serviceActor).toBeNull();
    expect(result.claims.sub).toBe("client-id");
  });

  it.each([
    ["missing iat", { iat: undefined }],
    ["non-integer iat", { iat: TEST_NOW - 0.5 }],
    [
      "future iat beyond clock skew",
      { iat: TEST_NOW + M2M_CLOCK_SKEW_SECONDS + 1 },
    ],
    ["non-integer nbf", { nbf: TEST_NOW - 0.5 }],
    [
      "future nbf beyond clock skew",
      { nbf: TEST_NOW + M2M_CLOCK_SKEW_SECONDS + 1 },
    ],
  ])("rejects machine tokens with %s", async (_name, override) => {
    await expect(
      validator().validate(`Bearer ${mintJwt(claims(override), key)}`),
    ).rejects.toMatchObject({ errorCode: "AUTH_INVALID_M2M_TOKEN" });
  });

  it.each([
    ["past nbf", { nbf: TEST_NOW - 1 }],
    ["current nbf", { nbf: TEST_NOW }],
    [
      "iat and nbf at clock-skew boundary",
      {
        iat: TEST_NOW + M2M_CLOCK_SKEW_SECONDS,
        nbf: TEST_NOW + M2M_CLOCK_SKEW_SECONDS,
      },
    ],
  ])("accepts machine tokens with %s", async (_name, override) => {
    await expect(
      validator().validate(`Bearer ${mintJwt(claims(override), key)}`),
    ).resolves.toMatchObject({ serviceActor: null });
  });

  it.each([
    ["expired", { exp: TEST_NOW }],
    ["wrong issuer", { iss: "https://other.example/" }],
    ["wrong audience", { aud: "other-api" }],
  ])("rejects %s machine tokens", async (_name, override) => {
    await expect(
      validator().validate(`Bearer ${mintJwt(claims(override), key)}`),
    ).rejects.toMatchObject({ errorCode: "AUTH_INVALID_M2M_TOKEN" });
  });

  it("rejects a bad signature and malformed authorization", async () => {
    const otherKey = testSigningKey(key.kid);
    await expect(
      validator().validate(`Bearer ${mintJwt(claims(), otherKey)}`),
    ).rejects.toMatchObject({ errorCode: "AUTH_INVALID_M2M_TOKEN" });
    await expect(validator().validate("Basic value")).rejects.toMatchObject({
      errorCode: "AUTH_INVALID_M2M_TOKEN",
    });
    await expect(validator().validate("Bearer   ")).rejects.toMatchObject({
      errorCode: "AUTH_INVALID_M2M_TOKEN",
    });
  });

  it("accepts an audience array and uses the real clock by default", async () => {
    const current = Math.floor(Date.now() / 1000);
    const value = new M2mValidator(
      { auth0Domain: "https://tenant.auth0.com/", apiAudience: audience },
      { fetch: jwksFetch(key) },
    );
    await expect(
      value.validate(
        `Bearer ${mintJwt(
          claims({
            aud: ["other", audience],
            exp: current + 60,
            iat: current,
          }),
          key,
        )}`,
      ),
    ).resolves.toMatchObject({ serviceActor: null });
  });

  it("caches known keys and refreshes once for a rotated kid", async () => {
    const rotated = testSigningKey("rotated-key");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [key.jwk] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [key.jwk, rotated.jwk] }),
      });
    const value = new M2mValidator(
      { auth0Domain: "tenant.auth0.com", apiAudience: audience },
      { fetch: fetcher, nowSeconds: () => TEST_NOW },
    );

    await value.validate(`Bearer ${mintJwt(claims(), key)}`);
    await value.validate(`Bearer ${mintJwt(claims(), key)}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      value.validate(`Bearer ${mintJwt(claims(), rotated)}`),
    ).resolves.toMatchObject({ serviceActor: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("builds a service actor directly from custom claims", async () => {
    const result = await validator().validate(
      `Bearer ${mintJwt(
        claims({
          "https://alter.dev/claims/actor_type": "service",
          tenant_id: TEST_TENANT,
          workspace_id: TEST_WORKSPACE,
          roles: ["service"],
          permissions: ["event:write"],
        }),
        key,
      )}`,
    );
    expect(result.serviceActor).toEqual({
      actor_type: "service",
      user_id: null,
      tenant_id: TEST_TENANT,
      workspace_id: TEST_WORKSPACE,
      roles: ["service"],
      permissions: ["event:write"],
      session_id: null,
      jti: null,
    });
  });

  it("rejects a service actor without tenant scope", async () => {
    await expect(
      validator().validate(
        `Bearer ${mintJwt(
          claims({ "https://alter.dev/claims/actor_type": "service" }),
          key,
        )}`,
      ),
    ).rejects.toMatchObject({ errorCode: "AUTH_INVALID_M2M_TOKEN" });
  });

  it("defaults optional service claims and rejects malformed arrays", async () => {
    const minimal = await validator().validate(
      `Bearer ${mintJwt(
        claims({
          "https://alter.dev/claims/actor_type": "service",
          tenant_id: TEST_TENANT,
        }),
        key,
      )}`,
    );
    expect(minimal.serviceActor).toMatchObject({
      workspace_id: null,
      roles: [],
      permissions: [],
    });

    await expect(
      validator().validate(
        `Bearer ${mintJwt(
          claims({
            "https://alter.dev/claims/actor_type": "service",
            tenant_id: TEST_TENANT,
            roles: ["service", 1],
          }),
          key,
        )}`,
      ),
    ).rejects.toMatchObject({ errorCode: "AUTH_INVALID_M2M_TOKEN" });
  });
});
