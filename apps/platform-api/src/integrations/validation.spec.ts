import { describe, expect, it } from "vitest";
import { parseOAuthAuthorizeInput } from "./validation";

const instance = "/api/v1/integrations/test/actions/authorize";

describe("OAuth connector tenant configuration validation", () => {
  it.each([
    ["zendesk", { subdomain: "alter-support" }],
    ["salesforce", { login_host: "acme.my.salesforce.com" }],
    ["shopify", { shop_domain: "acme.myshopify.com" }],
    ["m365", { tenant: "00000000-0000-7000-8000-000000000001" }],
  ] as const)("preserves validated %s configuration", (connector, tenantConfig) => {
    expect(
      parseOAuthAuthorizeInput(
        { redirect_uri: "https://app.alter.ai/callback", tenant_config: tenantConfig },
        connector,
        instance,
      ),
    ).toMatchObject({ tenant_config: { connector, ...tenantConfig } });
  });

  it.each([
    ["zendesk", { subdomain: "https://evil.example/zendesk" }],
    ["salesforce", { login_host: "evil.example" }],
    ["shopify", { shop_domain: "evil.example" }],
    ["m365", { tenant: "organizations/../../evil" }],
  ] as const)("rejects unsafe %s endpoint configuration", (connector, tenantConfig) => {
    expect(() =>
      parseOAuthAuthorizeInput(
        { redirect_uri: "https://app.alter.ai/callback", tenant_config: tenantConfig },
        connector,
        instance,
      ),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("rejects invented configuration for global providers", () => {
    expect(() =>
      parseOAuthAuthorizeInput(
        {
          redirect_uri: "https://app.alter.ai/callback",
          tenant_config: { subdomain: "not-used" },
        },
        "x",
        instance,
      ),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
