import { describe, expect, it } from "vitest";
import {
  parseCreateListingVersion,
  parseCreateReview,
  parseInstallListing,
} from "./validation";

const instance = "/api/v1/marketplace/listings";
const base = { version: "1.0.0", payload_ref: "s3://bucket/template.json", compatibility: { dagSchemaVersion: "1", nodeTypes: [], connectorCapabilities: [], requiredEntitlements: [] } };

describe("marketplace validation", () => {
  it("rejects unknown entitlement with named field error", () => {
    try { parseCreateListingVersion({ ...base, compatibility: { ...base.compatibility, requiredEntitlements: ["madeUpLimit"] } }, instance); } catch (error) { expect(error).toMatchObject({ response: { error_code: "MARKETPLACE_UNKNOWN_ENTITLEMENT", field_errors: [{ field: "compatibility.requiredEntitlements.0" }] } }); return; }
    throw new Error("Expected validation error");
  });
  it.each([0, 6, 1.5])("rejects invalid rating %s", (rating) => {
    expect(() => parseCreateReview({ rating }, instance)).toThrow();
  });

  // Spec 5 — install requires explicit confirmation, never an implicit default.
  const validVersionId = "lsv_018f47a5-7b2c-7d10-8f11-1234567890ae";

  it("rejects an install body without explicit confirmation", () => {
    expect(() =>
      parseInstallListing({ listing_version_id: validVersionId }, instance),
    ).toThrow();
    expect(() =>
      parseInstallListing(
        { listing_version_id: validVersionId, confirmed: false },
        instance,
      ),
    ).toThrow();
  });

  it("accepts an install body that confirms explicitly", () => {
    expect(
      parseInstallListing(
        { listing_version_id: validVersionId, confirmed: true },
        instance,
      ),
    ).toEqual({ listing_version_id: validVersionId, confirmed: true });
  });
});
