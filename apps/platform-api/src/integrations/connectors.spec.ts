import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG, findConnector, isConnectorId } from "./connectors";

describe("connector catalog", () => {
  it("declares exactly the locked launch subset: github, google, slack, hubspot, linkedin", () => {
    expect(CONNECTOR_CATALOG.map((c) => c.id).sort()).toEqual([
      "github",
      "google",
      "hubspot",
      "linkedin",
      "slack",
    ]);
  });

  it("finds a connector by id and rejects unknown ids", () => {
    expect(findConnector("github")?.displayName).toBe("GitHub");
    expect(findConnector("slack")?.displayName).toBe("Slack");
    expect(findConnector("hubspot")?.displayName).toBe("HubSpot");
    expect(findConnector("linkedin")?.displayName).toBe("LinkedIn");
    expect(findConnector("zendesk")).toBeUndefined();
    expect(isConnectorId("google")).toBe(true);
    expect(isConnectorId("zendesk")).toBe(false);
  });

  it("marks PKCE correctly per connector", () => {
    expect(findConnector("github")?.pkce).toBe(false);
    expect(findConnector("google")?.pkce).toBe(true);
    expect(findConnector("slack")?.pkce).toBe(false);
    expect(findConnector("hubspot")?.pkce).toBe(false);
    expect(findConnector("linkedin")?.pkce).toBe(false);
  });

  it("flags revoke as unsupported where the provider has no revoke endpoint", () => {
    expect(findConnector("linkedin")?.revokeUrl).toBeNull();
  });

  it("marks non-launch, per-tenant-URL connectors as absent, not fabricated", () => {
    for (const id of ["x", "salesforce", "shopify", "zendesk", "m365"]) {
      expect(isConnectorId(id)).toBe(false);
    }
  });
});
