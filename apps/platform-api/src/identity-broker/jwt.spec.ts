import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeActorToken, signActorToken, verifyActorToken } from "./jwt";

describe("actor token JWT", () => {
  it("rejects malformed decode and verification inputs", () => {
    expect(() => decodeActorToken("invalid")).toThrow("Invalid actor token");
    for (const token of ["", "a", "a.b", ".b.c", "a..c", "a.b."]) {
      expect(verifyActorToken(token, "not-used")).toBe(false);
    }
  });

  it("rejects a valid-shaped token signed by another key", () => {
    const first = keyPair();
    const second = keyPair();
    const token = signActorToken(
      {
        user_id: "user",
        tenant_id: "tenant",
        workspace_id: "workspace",
        roles: [],
        permissions: [],
        session_id: "session",
        auth_time: 1,
        jti: "jti",
        iss: "issuer",
        aud: "audience",
        iat: 1,
        exp: 2,
      },
      first.privateKey,
    );
    expect(verifyActorToken(token, second.publicKey)).toBe(false);
  });
});

function keyPair(): { privateKey: string; publicKey: string } {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
