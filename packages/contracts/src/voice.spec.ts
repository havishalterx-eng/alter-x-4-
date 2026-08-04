import { describe, expect, it } from "vitest";
import {
  CreateVoiceNumberBindingRequestSchema,
  E164PhoneNumberSchema,
  InitiateVoiceCallRequestSchema,
  VoiceCallHandlingConfigurationSchema,
} from "./voice";

const voiceAccountId = "voc_00000000-0000-7000-8000-000000000001";
const workspaceId = "ws_00000000-0000-7000-8000-000000000001";

describe("voice contracts", () => {
  it("accepts a vendor-neutral binding request with a secret reference", () => {
    const request = {
      workspace_id: workspaceId,
      provider: "twilio" as const,
      phone_number: "+14155550100",
      credential_reference: "secretref://voice/twilio/acme",
      call_handling: {
        inbound_calls_enabled: true,
        voice_style: { language_tag: "en-IN", voice_style: "professional" },
      },
    };

    expect(CreateVoiceNumberBindingRequestSchema.parse(request)).toEqual(request);
  });

  it.each(["14155550100", "+0123456789", "+14155550100123456"])(
    "rejects non-E.164 number %s",
    (phoneNumber) => {
      expect(E164PhoneNumberSchema.safeParse(phoneNumber).success).toBe(false);
    },
  );

  it("does not allow a platform client to set webhook URLs", () => {
    expect(
      VoiceCallHandlingConfigurationSchema.safeParse({
        inbound_calls_enabled: true,
        voice_style: { language_tag: "hi-IN" },
        inbound_webhook_url: "https://attacker.invalid/webhook",
      }).success,
    ).toBe(false);
  });

  it("requires a bound account for an outbound call", () => {
    expect(
      InitiateVoiceCallRequestSchema.parse({
        voice_account_id: voiceAccountId,
        to_phone_number: "+919876543210",
      }),
    ).toMatchObject({ voice_account_id: voiceAccountId });
  });
});
