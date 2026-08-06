export type {
  CreateVoiceNumberBindingRequest,
  InitiateVoiceCallRequest,
  UpdateVoiceCallHandlingRequest,
  VoiceAccountHealth,
  VoiceCapabilities,
  VoiceNumberBinding,
  VoiceNumberBindingList,
} from "@alterx/contracts";

export interface VoicePagination {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

// Engine's real gRPC management contract (packages/contracts/proto/alter/voice/v1/voice.proto,
// InitiateCallResponse) returns only { provider_call_reference, status }. The REST contract
// package types the same route's 200 response as the full VoiceCall shape, which Engine does
// not actually populate. Relaying the wider type here would fabricate fields Engine never sends,
// so POST /channels/voice/calls stays untyped/opaque until the two contracts are reconciled.
export const voiceDeferredCapabilities = [
  {
    capability: "voice_provider_round_trip",
    status: "NOT_MET",
    reason:
      "Number binding, call-handling, and initiate-call code paths are real (no mocks) but " +
      "unexercised against a live Exotel/Twilio sandbox through Engine. Flip to MET once " +
      "ENGINE_BASE_URL points at an Engine deployment with real Exotel/Twilio credentials " +
      "provisioned behind credential_reference, and a live round-trip test is run.",
  },
  {
    capability: "voice_call_initiate_response_shape",
    status: "NOT_MET",
    reason:
      "openapi.json types POST /channels/voice/calls' 200 response as VoiceCall, but Engine's " +
      "InitiateCallResponse (voice.proto) only returns provider_call_reference and status. This " +
      "module relays Engine's response body opaquely rather than parsing it as VoiceCall. Flip to " +
      "MET once the REST and proto contracts are reconciled and Engine's real response is verified.",
  },
] as const;
