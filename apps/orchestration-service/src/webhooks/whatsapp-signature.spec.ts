import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyWhatsappSignature } from "./whatsapp-signature";

const APP_SECRET = "test-app-secret";

function signedHeader(body: Buffer, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyWhatsappSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(
      verifyWhatsappSignature(body, signedHeader(body), APP_SECRET),
    ).toBe(true);
  });

  it("rejects a body that was tampered with after signing", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const header = signedHeader(body);
    const tamperedBody = Buffer.from(JSON.stringify({ hello: "mallory" }));
    expect(verifyWhatsappSignature(tamperedBody, header, APP_SECRET)).toBe(
      false,
    );
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const header = signedHeader(body, "wrong-secret");
    expect(verifyWhatsappSignature(body, header, APP_SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const body = Buffer.from("{}");
    expect(verifyWhatsappSignature(body, undefined, APP_SECRET)).toBe(false);
  });

  it("rejects a header missing the sha256= prefix", () => {
    const body = Buffer.from("{}");
    const header = createHmac("sha256", APP_SECRET).update(body).digest("hex");
    expect(verifyWhatsappSignature(body, header, APP_SECRET)).toBe(false);
  });

  it("rejects a non-hex digest", () => {
    const body = Buffer.from("{}");
    expect(
      verifyWhatsappSignature(body, "sha256=not-hex-zzz", APP_SECRET),
    ).toBe(false);
  });

  it("rejects a digest of the wrong length", () => {
    const body = Buffer.from("{}");
    expect(verifyWhatsappSignature(body, "sha256=abcd", APP_SECRET)).toBe(
      false,
    );
  });

  it("rejects an empty body signed with a different secret", () => {
    const body = Buffer.from("");
    const header = signedHeader(body, "wrong-secret");
    expect(verifyWhatsappSignature(body, header, APP_SECRET)).toBe(false);
  });
});
