import { createSign, createVerify } from "node:crypto";
import type { ActorTokenClaims } from "./actor-token.types";

const algorithm = "RS256";

export function signActorToken(claims: ActorTokenClaims, privateKey: string): string {
  const header = { alg: algorithm, typ: "JWT" };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);

  return `${signingInput}.${signature.toString("base64url")}`;
}

export function decodeActorToken(token: string): ActorTokenClaims {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new Error("Invalid actor token");
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ActorTokenClaims;
}

export function verifyActorToken(token: string, publicKey: string): boolean {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) {
    return false;
  }

  return createVerify("RSA-SHA256")
    .update(`${header}.${payload}`)
    .verify(publicKey, Buffer.from(signature, "base64url"));
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
