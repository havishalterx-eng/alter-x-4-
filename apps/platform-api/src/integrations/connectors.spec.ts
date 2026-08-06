import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG, findConnector, isConnectorId } from "./connectors";

describe("connector catalog", () => {
  it("declares the full launch connector set", () => {
    expect(CONNECTOR_CATALOG.map((c) => c.id).sort()).toEqual([
      "github",
      "google",
      "hubspot",
      "linkedin",
      "m365",
      "salesforce",
      "shopify",
      "slack",
      "x",
      "zendesk",
    ]);
  });

  it("finds a connector by id and rejects unknown ids", () => {
    expect(findConnector("github")?.displayName).toBe("GitHub");
    expect(findConnector("slack")?.displayName).toBe("Slack");
    expect(findConnector("hubspot")?.displayName).toBe("HubSpot");
    expect(findConnector("linkedin")?.displayName).toBe("LinkedIn");
    expect(findConnector("zendesk")?.displayName).toBe("Zendesk");
    expect(findConnector("bogus")).toBeUndefined();
    expect(isConnectorId("google")).toBe(true);
    expect(isConnectorId("bogus")).toBe(false);
  });

  it("marks PKCE correctly per connector", () => {
    expect(findConnector("github")?.pkce).toBe(false);
    expect(findConnector("google")?.pkce).toBe(true);
    expect(findConnector("slack")?.pkce).toBe(false);
    expect(findConnector("hubspot")?.pkce).toBe(false);
    expect(findConnector("linkedin")?.pkce).toBe(false);
    expect(findConnector("zendesk")?.pkce).toBe(true);
    expect(findConnector("salesforce")?.pkce).toBe(true);
    expect(findConnector("shopify")?.pkce).toBe(false);
    expect(findConnector("x")?.pkce).toBe(true);
    expect(findConnector("m365")?.pkce).toBe(true);
  });

  it("flags revoke as unsupported where the provider has no revoke endpoint", () => {
    expect(findConnector("linkedin")?.resolveEndpoints(null).revokeUrl).toBeNull();
    expect(findConnector("shopify")?.resolveEndpoints(null).revokeUrl).toBeNull();
    expect(
      findConnector("m365")?.resolveEndpoints({ connector: "m365", tenant: "common" })
        .revokeUrl,
    ).toBeNull();
  });

  it("resolves fixed global endpoints for connectors with no per-tenant URL", () => {
    expect(findConnector("slack")?.resolveEndpoints(null).authorizeUrl).toBe(
      "https://slack.com/openid/connect/authorize",
    );
    expect(findConnector("hubspot")?.resolveEndpoints(null).revokeUrl).toBe(
      "https://api.hubapi.com/oauth/v1/refresh-tokens/",
    );
    expect(findConnector("linkedin")?.resolveEndpoints(null).authorizeUrl).toBe(
      "https://www.linkedin.com/oauth/v2/authorization",
    );
  });

  it("resolves tenant-specific provider endpoints without defaults", () => {
    expect(
      findConnector("zendesk")?.resolveEndpoints({
        connector: "zendesk",
        subdomain: "alter-support",
      }),
    ).toMatchObject({
      authorizeUrl: "https://alter-support.zendesk.com/oauth/authorizations/new",
      userInfoUrl: "https://alter-support.zendesk.com/api/v2/users/me.json",
    });
    expect(
      findConnector("shopify")?.resolveEndpoints({
        connector: "shopify",
        shop_domain: "alter-store.myshopify.com",
      }).tokenUrl,
    ).toBe("https://alter-store.myshopify.com/admin/oauth/access_token");
    expect(
      findConnector("m365")?.resolveEndpoints({ connector: "m365", tenant: "common" })
        .authorizeUrl,
    ).toContain("/common/oauth2/v2.0/authorize");
    expect(() => findConnector("zendesk")?.resolveEndpoints(null)).toThrow(
      /Tenant configuration required/,
    );
  });

  it("uses provider-specific scope and global endpoint semantics", () => {
    expect(findConnector("shopify")?.scopeSeparator).toBe(",");
    expect(findConnector("slack")?.scopeSeparator).toBe(" ");
    expect(findConnector("x")?.resolveEndpoints(null).tokenUrl).toBe(
      "https://api.x.com/2/oauth2/token",
    );
  });
});
