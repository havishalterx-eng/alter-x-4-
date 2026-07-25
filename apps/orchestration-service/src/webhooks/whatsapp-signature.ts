import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADER_PREFIX = "sha256=";

// Verifies Meta's X-Hub-Signature-256 header: HMAC-SHA256 over the exact
// raw request body bytes, keyed by the WhatsApp app secret. Must run
// against the raw (pre-JSON-parse) body -- any re-serialization of a
// parsed body is not guaranteed byte-identical to what Meta signed.
//
// Fails closed on every malformed input (missing header, wrong prefix,
// non-hex digest, wrong length): all return false, never throw, so a
// caller can treat "not true" as "reject" without needing to catch
// anything.
export function verifyWhatsappSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (signatureHeader === undefined) {
    return false;
  }
  if (!signatureHeader.startsWith(SIGNATURE_HEADER_PREFIX)) {
    return false;
  }
  const providedHex = signatureHeader.slice(SIGNATURE_HEADER_PREFIX.length);
  if (!/^[0-9a-f]+$/i.test(providedHex)) {
    return false;
  }

  const expectedHex = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, so the length check must happen first -- a length mismatch is
  // itself an invalid signature, not an error.
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
