import { describe, expect, it } from "vitest";

import {
  WhatsappWebhookConfigurationError,
  loadWhatsappWebhookEnvironment,
} from "./whatsapp-webhook-environment";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    WHATSAPP_APP_SECRET: "app-secret-value",
    WHATSAPP_VERIFY_TOKEN: "verify-token-value",
    ...overrides,
  };
}

describe("loadWhatsappWebhookEnvironment", () => {
  it("validates and returns the documented environment", () => {
    expect(loadWhatsappWebhookEnvironment(environment())).toEqual({
      appSecret: "app-secret-value",
      verifyToken: "verify-token-value",
      timestampSkewSeconds: 300,
    });
  });

  it("does not use legacy static tenancy values for webhook routing", () => {
    expect(
      loadWhatsappWebhookEnvironment(
        environment({
          WHATSAPP_TENANT_ID: "not-a-uuid",
          WHATSAPP_WORKSPACE_ID: "not-a-uuid",
        }),
      ),
    ).toEqual({
      appSecret: "app-secret-value",
      verifyToken: "verify-token-value",
      timestampSkewSeconds: 300,
    });
  });

  it("accepts a validated custom skew window", () => {
    expect(
      loadWhatsappWebhookEnvironment(
        environment({ WHATSAPP_TIMESTAMP_SKEW_SECONDS: "60" }),
      ),
    ).toMatchObject({ timestampSkewSeconds: 60 });
  });

  it.each([
    ["WHATSAPP_APP_SECRET", { WHATSAPP_APP_SECRET: "" }],
    ["WHATSAPP_VERIFY_TOKEN", { WHATSAPP_VERIFY_TOKEN: "" }],
    [
      "WHATSAPP_TIMESTAMP_SKEW_SECONDS",
      { WHATSAPP_TIMESTAMP_SKEW_SECONDS: "-5" },
    ],
    [
      "WHATSAPP_TIMESTAMP_SKEW_SECONDS",
      { WHATSAPP_TIMESTAMP_SKEW_SECONDS: "3.5" },
    ],
  ])("rejects invalid %s", (field, override) => {
    expect(() => loadWhatsappWebhookEnvironment(environment(override))).toThrow(
      WhatsappWebhookConfigurationError,
    );
    expect(() => loadWhatsappWebhookEnvironment(environment(override))).toThrow(
      field,
    );
  });
});
