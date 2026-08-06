// Live-verification harness for oauth_round_trip_verified_slack /
// _hubspot / _linkedin (see integrationDeferredCapabilities in ../../types).
// Skipped by default -- no real OAuth app credentials are provisioned yet.
//
// The authorization_code leg of 3-legged OAuth is inherently interactive
// (a real user must consent in a browser), so it can't be scripted here.
// Instead this harness takes a REAL access_token/refresh_token pair,
// obtained once manually by running the actual authorize -> callback flow
// against a live app, and exercises the parts that ARE automatable end to
// end against the real provider: account-id lookup and revoke. When
// credentials + a captured token pair land, setting the env vars below and
// running this file is the entire verification step -- no code changes.
//
// Per connector, required env vars:
//   SLACK_LIVE_TEST=1,    SLACK_LIVE_ACCESS_TOKEN
//   HUBSPOT_LIVE_TEST=1,  HUBSPOT_LIVE_ACCESS_TOKEN, HUBSPOT_LIVE_REFRESH_TOKEN
//   LINKEDIN_LIVE_TEST=1, LINKEDIN_LIVE_ACCESS_TOKEN
//
// Note: running the HubSpot revoke case invalidates the captured token pair
// (revoke is real and irreversible) -- a fresh manual authorize is needed to
// re-run it.
import { describe, expect, it } from "vitest";
import { findConnector } from "../../connectors";
import { createFetchOAuthHttpClient } from "./oauth-http-client";

const slack = findConnector("slack")!;
const hubspot = findConnector("hubspot")!;
const linkedin = findConnector("linkedin")!;
const slackEndpoints = slack.resolveEndpoints(null);
const hubspotEndpoints = hubspot.resolveEndpoints(null);
const linkedinEndpoints = linkedin.resolveEndpoints(null);

describe.skipIf(process.env.SLACK_LIVE_TEST !== "1" || !process.env.SLACK_LIVE_ACCESS_TOKEN)(
  "Slack OAuth live round trip",
  () => {
    it("resolves a real account id via openid.connect.userInfo", async () => {
      const client = createFetchOAuthHttpClient();
      const accountId = await client.fetchAccountId(
        "slack",
        slackEndpoints.userInfoUrl,
        process.env.SLACK_LIVE_ACCESS_TOKEN!,
      );
      expect(accountId).toBeTruthy();
    });
  },
);

describe.skipIf(
  process.env.HUBSPOT_LIVE_TEST !== "1" ||
    !process.env.HUBSPOT_LIVE_ACCESS_TOKEN ||
    !process.env.HUBSPOT_LIVE_REFRESH_TOKEN,
)("HubSpot OAuth live round trip", () => {
  it("resolves a real hub_id via the token-in-path access-tokens endpoint", async () => {
    const client = createFetchOAuthHttpClient();
    const accountId = await client.fetchAccountId(
      "hubspot",
      hubspotEndpoints.userInfoUrl,
      process.env.HUBSPOT_LIVE_ACCESS_TOKEN!,
    );
    expect(accountId).toBeTruthy();
  });

  it("revokes a real refresh token via DELETE /oauth/v1/refresh-tokens/{token} -- irreversible", async () => {
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "hubspot",
      endpoints: hubspotEndpoints,
      accessToken: process.env.HUBSPOT_LIVE_ACCESS_TOKEN!,
      refreshToken: process.env.HUBSPOT_LIVE_REFRESH_TOKEN!,
      clientId: process.env.HUBSPOT_LIVE_CLIENT_ID ?? "",
      clientSecret: process.env.HUBSPOT_LIVE_CLIENT_SECRET ?? "",
    });
    expect(result.revokedRemotely).toBe(true);
  });
});

describe.skipIf(process.env.LINKEDIN_LIVE_TEST !== "1" || !process.env.LINKEDIN_LIVE_ACCESS_TOKEN)(
  "LinkedIn OAuth live round trip",
  () => {
    it("resolves a real account id via the OIDC userinfo sub claim", async () => {
      const client = createFetchOAuthHttpClient();
      const accountId = await client.fetchAccountId(
        "linkedin",
        linkedinEndpoints.userInfoUrl,
        process.env.LINKEDIN_LIVE_ACCESS_TOKEN!,
      );
      expect(accountId).toBeTruthy();
    });

    it("confirms LinkedIn genuinely has no revoke endpoint, not an unverified assumption", async () => {
      const client = createFetchOAuthHttpClient();
      const result = await client.revoke({
        connector: "linkedin",
        endpoints: linkedinEndpoints,
        accessToken: process.env.LINKEDIN_LIVE_ACCESS_TOKEN!,
        refreshToken: null,
        clientId: process.env.LINKEDIN_LIVE_CLIENT_ID ?? "",
        clientSecret: process.env.LINKEDIN_LIVE_CLIENT_SECRET ?? "",
      });
      expect(result.revokedRemotely).toBe(false);
      expect(result.reason).toMatch(/no revoke endpoint/);
    });
  },
);
