import { describe, expect, it } from "vitest";
import { registryId } from "./id";
import { parseManifestId, parseVersionId } from "./validation";

// ENGINE-FIX-PHASE2-N1 regression: registryId() used to mint node:crypto's
// randomUUID() (always v4), while validation.ts's parseVersionId demands a
// literal UUIDv7 version nibble -- every version id the system minted for
// itself was rejected by its own validator on the very next scan/revoke
// call. Prove the real round trip, not just the generator's own shape.
describe("registryId", () => {
  it("mints a manifest id that parseManifestId accepts", () => {
    const id = registryId("tlm");
    expect(id).toMatch(/^tlm_/);
    expect(() => parseManifestId(id, "/registry")).not.toThrow();
  });

  it("mints a version id that parseVersionId accepts", () => {
    const id = registryId("tlv");
    expect(id).toMatch(/^tlv_/);
    expect(() => parseVersionId(id, "/registry")).not.toThrow();
  });

  it("mints a real UUIDv7 (version nibble 7, variant nibble 8-b)", () => {
    const [, uuid] = registryId("scn").split(/_(.+)/);
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
