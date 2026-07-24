import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ActorTokenClaimsSchema as CanonicalActorTokenClaimsSchema } from "../../../contracts/src/actor-token";
import {
  ActorContextSchema,
  ActorTokenClaimsSchema,
} from "../../../contracts/auth/v1/actor-token.schema";
import { actorClaims } from "../test-utils/jwt-fixture";

describe("Session Gateway contract and production boundary", () => {
  it("re-exports the canonical actor-token schema without drift", () => {
    expect(ActorTokenClaimsSchema).toBe(CanonicalActorTokenClaimsSchema);
    expect(ActorTokenClaimsSchema.safeParse(actorClaims()).success).toBe(true);
    expect(
      ActorContextSchema.safeParse({
        actor_type: "user",
        user_id: actorClaims().user_id,
        tenant_id: actorClaims().tenant_id,
        workspace_id: actorClaims().workspace_id,
        roles: [],
        permissions: [],
        session_id: actorClaims().session_id,
        jti: actorClaims().jti,
      }).success,
    ).toBe(true);
  });

  it("does not export the test-only signer from production", async () => {
    const productionIndex = await readFile(
      resolve(
        process.cwd(),
        "packages/auth/session-gateway/src/index.ts",
      ),
      "utf8",
    );
    expect(productionIndex).not.toContain("mint-test-actor-token");
  });
});
