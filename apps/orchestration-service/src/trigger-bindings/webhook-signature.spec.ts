import { describe, expect, it } from "vitest";
import { signWebhookRequest, verifyWebhookRequest } from "./webhook-signature";

const SECRET = "test-secret";
const NOW = new Date("2026-08-06T12:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1_000));
const BODY = Buffer.from('{"type":"issue.opened","number":42}', "utf8");

function verify(overrides: Partial<Parameters<typeof verifyWebhookRequest>[0]> = {}) {
  return verifyWebhookRequest({
    rawBody: BODY,
    signatureHeader: signWebhookRequest(TIMESTAMP, BODY, SECRET),
    timestampHeader: TIMESTAMP,
    secret: SECRET,
    maxSkewSeconds: 300,
    now: NOW,
    ...overrides,
  });
}

describe("verifyWebhookRequest", () => {
  it("accepts a correctly signed request", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("rejects a wrong secret", () => {
    expect(verify({ secret: "wrong-secret" })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a body altered after signing", () => {
    expect(verify({ rawBody: Buffer.from('{"type":"issue.closed"}') })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a replayed signature carrying a fresh timestamp", () => {
    // The timestamp is inside the signed payload, so swapping it invalidates
    // a captured signature rather than extending its life.
    const fresh = String(Math.floor(NOW.getTime() / 1_000) + 10);
    expect(verify({ timestampHeader: fresh })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a timestamp outside the skew window", () => {
    const stale = String(Math.floor(NOW.getTime() / 1_000) - 3_600);
    expect(
      verify({
        timestampHeader: stale,
        signatureHeader: signWebhookRequest(stale, BODY, SECRET),
      }),
    ).toEqual({ ok: false, reason: "timestamp_skew" });
  });

  it.each([
    ["missing", undefined, "missing_signature"],
    ["empty", "", "missing_signature"],
    ["unprefixed", "deadbeef", "malformed_signature"],
    ["non-hex", "sha256=zzzz", "malformed_signature"],
    ["short", "sha256=ab", "signature_mismatch"],
  ] as const)("fails closed on a %s signature header", (_label, header, reason) => {
    expect(verify({ signatureHeader: header })).toEqual({ ok: false, reason });
  });

  it.each([
    ["missing", undefined, "missing_timestamp"],
    ["non-numeric", "not-a-number", "malformed_timestamp"],
  ] as const)("fails closed on a %s timestamp header", (_label, header, reason) => {
    expect(verify({ timestampHeader: header })).toEqual({ ok: false, reason });
  });

  it("never throws on malformed input", () => {
    expect(() =>
      verifyWebhookRequest({
        rawBody: Buffer.alloc(0),
        signatureHeader: "sha256=",
        timestampHeader: "0",
        secret: "",
        maxSkewSeconds: 300,
        now: NOW,
      }),
    ).not.toThrow();
  });
});
