// Live-verification harness for the voice_provider_round_trip NOT_MET flag
// (see voiceDeferredCapabilities in ./types). Skipped by default because no
// live Exotel/Twilio sandbox is provisioned behind Engine yet -- see
// CREDENTIALS-LATER posture. When credentials land, set every env var below
// and run this file directly; no code changes are needed to flip the flag.
//
// Required:
//   VOICE_LIVE_TEST=1
//   ENGINE_BASE_URL, ENGINE_M2M_TOKEN_URL, ENGINE_M2M_AUDIENCE,
//   ENGINE_M2M_CLIENT_ID, ENGINE_M2M_CLIENT_SECRET_REF (resolvable via the
//   same runtime secret resolver production uses)
//   VOICE_LIVE_ACTOR_TOKEN     -- a real, already-minted actor token for the
//                                 tenant/workspace below
//   VOICE_LIVE_TENANT_ID, VOICE_LIVE_WORKSPACE_ID, VOICE_LIVE_USER_ID
//   VOICE_LIVE_PROVIDER        -- "exotel" | "twilio"
//   VOICE_LIVE_PHONE_NUMBER    -- E.164 number already reserved with the
//                                 provider
//   VOICE_LIVE_CREDENTIAL_REFERENCE -- an existing Credential Vault reference
//
// Optional, additional opt-in (placing a real outbound call is billable):
//   VOICE_LIVE_ALLOW_CALL=1
//   VOICE_LIVE_CALL_TO_PHONE_NUMBER -- E.164 destination for the test call
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@alterx/shared-clients";
import { resolveRuntimeSecret } from "../../identity/identity.module";
import {
  Auth0EngineM2mTokenProvider,
  EngineClient,
  engineConfigFromEnvironment,
  type EngineAuthProvider,
} from "../../engine";

const requiredVars = [
  "ENGINE_BASE_URL",
  "ENGINE_M2M_TOKEN_URL",
  "ENGINE_M2M_AUDIENCE",
  "ENGINE_M2M_CLIENT_ID",
  "ENGINE_M2M_CLIENT_SECRET_REF",
  "VOICE_LIVE_ACTOR_TOKEN",
  "VOICE_LIVE_TENANT_ID",
  "VOICE_LIVE_WORKSPACE_ID",
  "VOICE_LIVE_USER_ID",
  "VOICE_LIVE_PROVIDER",
  "VOICE_LIVE_PHONE_NUMBER",
  "VOICE_LIVE_CREDENTIAL_REFERENCE",
] as const;

const liveEnabled =
  process.env.VOICE_LIVE_TEST === "1" &&
  requiredVars.every((name) => Boolean(process.env[name]));
const callEnabled =
  liveEnabled &&
  process.env.VOICE_LIVE_ALLOW_CALL === "1" &&
  Boolean(process.env.VOICE_LIVE_CALL_TO_PHONE_NUMBER);

describe.skipIf(!liveEnabled)("Voice Engine live round trip", () => {
  it("binds a real number, reads live capabilities and health through Engine", async () => {
    const config = engineConfigFromEnvironment(process.env);
    const m2mProvider = new Auth0EngineM2mTokenProvider({
      tokenUrl: config.m2mTokenUrl,
      audience: config.m2mAudience,
      clientId: config.m2mClientId,
      clientSecretRef: config.m2mClientSecretRef,
      resolveSecret: resolveRuntimeSecret,
    });
    const authProvider: EngineAuthProvider = {
      authorize: async (context) => ({
        m2mAccessToken: await m2mProvider.getAccessToken(context.tenantId),
        actorToken: process.env.VOICE_LIVE_ACTOR_TOKEN!,
      }),
    };
    const engine = new EngineClient(config, authProvider);
    const context = {
      userId: process.env.VOICE_LIVE_USER_ID!,
      tenantId: process.env.VOICE_LIVE_TENANT_ID!,
      workspaceId: process.env.VOICE_LIVE_WORKSPACE_ID!,
      sessionId: "voice-live-verification",
      authTime: Math.floor(Date.now() / 1_000),
      roles: ["admin"],
      permissions: ["integrations:read", "integrations:write"],
      traceparent: "00-00000000000000000000000000000001-0000000000000001-01",
    };

    const bind = await engine.post<JsonValue, { id: string }>(
      "/api/v1/channels/voice/numbers",
      {
        workspace_id: context.workspaceId,
        provider: process.env.VOICE_LIVE_PROVIDER!,
        phone_number: process.env.VOICE_LIVE_PHONE_NUMBER!,
        credential_reference: process.env.VOICE_LIVE_CREDENTIAL_REFERENCE!,
        call_handling: {
          inbound_calls_enabled: true,
          voice_style: { language_tag: "en-IN" },
        },
      } as unknown as JsonValue,
      context,
      { idempotencyKey: `voice-live-bind-${Date.now()}` },
    );
    expect(bind.status).toBe(201);
    const voiceAccountId = bind.body?.id;
    expect(voiceAccountId).toBeTruthy();

    const capabilities = await engine.get(
      `/api/v1/channels/voice/numbers/${voiceAccountId}/capabilities`,
      context,
    );
    expect(capabilities.status).toBe(200);

    const health = await engine.get(
      `/api/v1/channels/voice/numbers/${voiceAccountId}/health`,
      context,
    );
    expect(health.status).toBe(200);

    if (callEnabled) {
      const call = await engine.post<JsonValue, unknown>(
        "/api/v1/channels/voice/calls",
        {
          voice_account_id: voiceAccountId as string,
          to_phone_number: process.env.VOICE_LIVE_CALL_TO_PHONE_NUMBER!,
        } as unknown as JsonValue,
        context,
        { idempotencyKey: `voice-live-call-${Date.now()}` },
      );
      expect(call.status).toBe(202);
    }
  });
});
