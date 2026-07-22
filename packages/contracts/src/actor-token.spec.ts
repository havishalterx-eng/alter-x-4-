import { describe, expect, it } from "vitest";
import { ActorTokenClaimsSchema } from "./actor-token";
import { ids } from "./test-fixtures";

const validClaims = {
  user_id: ids.user,
  tenant_id: ids.tenant,
  workspace_id: ids.workspace,
  roles: ["operator"],
  permissions: ["runs:start"],
  session_id: "session-42",
  auth_time: 1_750_000_000,
  jti: "jwt-42",
  iss: "alter-identity-broker",
  aud: "alter-engine",
  iat: 1_750_000_010,
  exp: 1_750_000_310,
};

describe("ActorTokenClaimsSchema", () => {
  it("contains exactly the 12 Alter-owned delegation claims", () => {
    expect(Object.keys(ActorTokenClaimsSchema.shape)).toEqual([
      "user_id",
      "tenant_id",
      "workspace_id",
      "roles",
      "permissions",
      "session_id",
      "auth_time",
      "jti",
      "iss",
      "aud",
      "iat",
      "exp",
    ]);
  });

  it("accepts a human actor token with a five-minute lifetime", () => {
    expect(ActorTokenClaimsSchema.parse(validClaims)).toEqual(validClaims);
  });

  it("accepts a service actor without fabricating a human user", () => {
    expect(
      ActorTokenClaimsSchema.safeParse({
        ...validClaims,
        user_id: "svc_event-gateway",
      }).success,
    ).toBe(true);
  });

  it("rejects delegation tokens longer than five minutes", () => {
    expect(
      ActorTokenClaimsSchema.safeParse({
        ...validClaims,
        exp: validClaims.iat + 301,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing required claim", () => {
    const withoutJti = { ...validClaims, jti: undefined };
    expect(ActorTokenClaimsSchema.safeParse(withoutJti).success).toBe(false);
  });
});
