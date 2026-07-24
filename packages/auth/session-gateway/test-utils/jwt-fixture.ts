import {
  createSign,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import type { ActorTokenClaims } from "@alterx/contracts";

export const TEST_NOW = 1_800_000_000;
export const TEST_TENANT = "ten_00000000-0000-7000-8000-000000000001";
export const TEST_WORKSPACE = "ws_00000000-0000-7000-8000-000000000002";
export const TEST_USER = "usr_00000000-0000-7000-8000-000000000003";

export interface TestSigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly jwk: JsonWebKey;
}

export function testSigningKey(kid = "test-key"): TestSigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    kid,
    privateKey,
    jwk: {
      ...publicKey.export({ format: "jwk" }),
      kid,
      alg: "RS256",
      use: "sig",
    },
  };
}

export function mintJwt(
  claims: Readonly<Record<string, unknown>>,
  key: Pick<TestSigningKey, "kid" | "privateKey">,
): string {
  const header = { alg: "RS256", kid: key.kid, typ: "JWT" };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  return `${signingInput}.${createSign("RSA-SHA256")
    .update(signingInput)
    .sign(key.privateKey)
    .toString("base64url")}`;
}

export function actorClaims(
  overrides: Partial<ActorTokenClaims> = {},
): ActorTokenClaims {
  return {
    user_id: TEST_USER,
    tenant_id: TEST_TENANT,
    workspace_id: TEST_WORKSPACE,
    roles: ["member"],
    permissions: ["workflow:read"],
    session_id: "session-test",
    auth_time: TEST_NOW - 60,
    jti: "jti-test",
    iss: "alter-platform-api.identity-broker",
    aud: "alter-engine",
    iat: TEST_NOW,
    exp: TEST_NOW + 300,
    ...overrides,
  };
}

export function jwksFetch(...keys: TestSigningKey[]) {
  return async () => ({
    ok: true,
    json: async () => ({ keys: keys.map((key) => key.jwk) }),
  });
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
