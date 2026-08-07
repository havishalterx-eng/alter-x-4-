import { describe, expect, it } from "vitest";
import { createFetchOAuthHttpClient } from "./adapters/oauth/oauth-http-client";
import { findConnector, type ConnectorId, type ConnectorTenantConfig } from "./connectors";

interface LiveConnectorCase {
  readonly connector: ConnectorId;
  readonly flag: string;
  readonly accessToken: string;
  readonly tenantConfig: () => ConnectorTenantConfig | null;
}

const liveCases: readonly LiveConnectorCase[] = [
  {
    connector: "zendesk",
    flag: "ZENDESK_LIVE_TEST",
    accessToken: "ZENDESK_LIVE_ACCESS_TOKEN",
    tenantConfig: () => ({
      connector: "zendesk",
      subdomain: required("ZENDESK_LIVE_SUBDOMAIN"),
    }),
  },
  {
    connector: "salesforce",
    flag: "SALESFORCE_LIVE_TEST",
    accessToken: "SALESFORCE_LIVE_ACCESS_TOKEN",
    tenantConfig: () => ({
      connector: "salesforce",
      login_host: required("SALESFORCE_LIVE_LOGIN_HOST"),
    }),
  },
  {
    connector: "shopify",
    flag: "SHOPIFY_LIVE_TEST",
    accessToken: "SHOPIFY_LIVE_ACCESS_TOKEN",
    tenantConfig: () => ({
      connector: "shopify",
      shop_domain: required("SHOPIFY_LIVE_SHOP_DOMAIN"),
    }),
  },
  {
    connector: "x",
    flag: "X_LIVE_TEST",
    accessToken: "X_LIVE_ACCESS_TOKEN",
    tenantConfig: () => null,
  },
  {
    connector: "m365",
    flag: "M365_LIVE_TEST",
    accessToken: "M365_LIVE_ACCESS_TOKEN",
    tenantConfig: () => ({
      connector: "m365",
      tenant: required("M365_LIVE_TENANT"),
    }),
  },
];

for (const liveCase of liveCases) {
  describe.skipIf(process.env[liveCase.flag] !== "1")(
    `${liveCase.connector} live OAuth harness`,
    () => {
      it("retrieves a real provider account identity", async () => {
        const definition = findConnector(liveCase.connector)!;
        const endpoints = definition.resolveEndpoints(liveCase.tenantConfig());
        const accountId = await createFetchOAuthHttpClient().fetchAccountId(
          liveCase.connector,
          endpoints.userInfoUrl,
          required(liveCase.accessToken),
        );
        expect(accountId.length).toBeGreaterThan(0);
      });
    },
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when its live test is enabled`);
  return value;
}
