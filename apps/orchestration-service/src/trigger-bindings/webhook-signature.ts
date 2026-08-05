import { createHmac, timingSafeEqual } from "node:crypto";
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@alterx/contracts";

const SIGNATURE_PREFIX = "sha256=";

export { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER };

export type SignatureRejection =
  | "missing_timestamp"
  | "malformed_timestamp"
  | "timestamp_skew"
  | "missing_signature"
  | "malformed_signature"
  | "signature_mismatch";

export type SignatureVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SignatureRejection };

/**
 * The exact bytes an HMAC is computed over: `${timestamp}.${rawBody}`.
 * Binding the timestamp into the signed payload is what makes the skew check
 * meaningful -- a replayer cannot keep a captured signature and swap in a
 * fresh timestamp.
 */
export function signaturePayload(timestamp: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]);
}

/** Produces the `sha256=<hex>` header value. Used by tests and by senders. */
export function signWebhookRequest(
  timestamp: string,
  rawBody: Buffer,
  secret: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(signaturePayload(timestamp, rawBody))
    .digest("hex");
  return `${SIGNATURE_PREFIX}${digest}`;
}

/**
 * Fails closed on every malformed input and never throws, so a caller can
 * treat "not ok" as "reject" without catching. Returns a machine-readable
 * reason for metrics; the reason is deliberately NOT echoed to the sender,
 * which only ever sees a generic 401.
 */
export function verifyWebhookRequest(input: {
  readonly rawBody: Buffer;
  readonly signatureHeader: string | undefined;
  readonly timestampHeader: string | undefined;
  readonly secret: string;
  readonly maxSkewSeconds: number;
  readonly now?: Date;
}): SignatureVerdict {
  const { rawBody, signatureHeader, timestampHeader, secret, maxSkewSeconds } =
    input;

  if (timestampHeader === undefined || timestampHeader.length === 0) {
    return { ok: false, reason: "missing_timestamp" };
  }
  if (!/^\d{1,19}$/.test(timestampHeader)) {
    return { ok: false, reason: "malformed_timestamp" };
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const skew = Math.abs(nowSeconds - Number(timestampHeader));
  if (skew > maxSkewSeconds) {
    return { ok: false, reason: "timestamp_skew" };
  }

  if (signatureHeader === undefined || signatureHeader.length === 0) {
    return { ok: false, reason: "missing_signature" };
  }
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { ok: false, reason: "malformed_signature" };
  }
  const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]+$/i.test(providedHex)) {
    return { ok: false, reason: "malformed_signature" };
  }

  const expectedHex = createHmac("sha256", secret)
    .update(signaturePayload(timestampHeader, rawBody))
    .digest("hex");
  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  // timingSafeEqual throws on length mismatch rather than returning false,
  // so length must be checked first -- a wrong length is itself a mismatch.
  if (provided.length !== expected.length) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return timingSafeEqual(provided, expected)
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}
