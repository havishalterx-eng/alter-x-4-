import { createSign, type KeyObject } from "node:crypto";
import type { ActorTokenClaims } from "@alterx/contracts";

export function mintTestActorToken(
  claims: ActorTokenClaims,
  privateKey: KeyObject | string,
  kid = "test-key",
): string {
  const header = { alg: "RS256", kid, typ: "JWT" };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
