/**
 * Compatibility shim: platform-api's Postgres rows use plain gen_random_uuid()
 * (v4, no prefix). packages/contracts/src/ids.ts is the system's real,
 * canonical ID contract -- every entity id is `<prefix>_<uuidv7>` -- and
 * ActorTokenClaimsSchema enforces it on user_id/tenant_id/workspace_id.
 * This stamps the version (0111) and variant (10xx) nibbles onto an
 * EXISTING uuid's bytes so it satisfies that contract's shape, without
 * re-randomizing or minting a new id: same input always produces the same
 * output, and the id still uniquely identifies the same row.
 *
 * This is not a real UUIDv7 (no embedded timestamp) -- it is only shaped to
 * pass validation at the token boundary. A real fix means migrating
 * platform-api's id generation to genuine prefixed UUIDv7 project-wide;
 * that is a real, separate migration, out of scope here.
 */
export function toPrefixedUuidV7(prefix: string, uuid: string): string {
  const hex = uuid.replaceAll("-", "");
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`toPrefixedUuidV7: not a UUID: ${uuid}`);
  }
  const bytes = Buffer.from(hex, "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const stamped = bytes.toString("hex");
  const body = `${stamped.slice(0, 8)}-${stamped.slice(8, 12)}-${stamped.slice(12, 16)}-${stamped.slice(16, 20)}-${stamped.slice(20)}`;
  return `${prefix}_${body}`;
}
