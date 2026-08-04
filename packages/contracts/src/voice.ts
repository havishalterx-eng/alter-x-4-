import {
  ExternalReferenceSchema,
  IsoTimestampSchema,
  WorkspaceIdSchema,
  VoiceAccountIdSchema,
} from "./ids";
import { z } from "./zod";

export const VoiceProviderKindSchema = z.enum(["exotel", "twilio"]);
export type VoiceProviderKind = z.infer<typeof VoiceProviderKindSchema>;

export const E164PhoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "Expected an E.164 phone number");
export type E164PhoneNumber = z.infer<typeof E164PhoneNumberSchema>;

export const Bcp47LanguageTagSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, "Expected a BCP 47 language tag");
export type Bcp47LanguageTag = z.infer<typeof Bcp47LanguageTagSchema>;

// Voice style is a capability requirement, not a vendor voice identifier.
// Provider adapters resolve it only from their advertised capability set.
export const VoiceStyleRequirementSchema = z
  .object({
    language_tag: Bcp47LanguageTagSchema,
    voice_style: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type VoiceStyleRequirement = z.infer<typeof VoiceStyleRequirementSchema>;

export const VoiceCallHandlingConfigurationSchema = z
  .object({
    inbound_calls_enabled: z.boolean(),
    voice_style: VoiceStyleRequirementSchema,
  })
  .strict();
export type VoiceCallHandlingConfiguration = z.infer<
  typeof VoiceCallHandlingConfigurationSchema
>;

export const VoiceAccountStatusSchema = z.enum([
  "pending",
  "active",
  "suspended",
  "failed",
]);
export type VoiceAccountStatus = z.infer<typeof VoiceAccountStatusSchema>;

export const VoiceNumberBindingSchema = z
  .object({
    id: VoiceAccountIdSchema,
    workspace_id: WorkspaceIdSchema,
    provider: VoiceProviderKindSchema,
    phone_number: E164PhoneNumberSchema,
    status: VoiceAccountStatusSchema,
    call_handling: VoiceCallHandlingConfigurationSchema,
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
  })
  .strict();
export type VoiceNumberBinding = z.infer<typeof VoiceNumberBindingSchema>;

// The credential reference is opaque. It may identify a SecretsProvider entry
// but is never a credential value and is never returned in a response.
export const CreateVoiceNumberBindingRequestSchema = z
  .object({
    workspace_id: WorkspaceIdSchema,
    provider: VoiceProviderKindSchema,
    phone_number: E164PhoneNumberSchema,
    credential_reference: ExternalReferenceSchema,
    call_handling: VoiceCallHandlingConfigurationSchema,
  })
  .strict();
export type CreateVoiceNumberBindingRequest = z.infer<
  typeof CreateVoiceNumberBindingRequestSchema
>;

export const UpdateVoiceCallHandlingRequestSchema = z
  .object({
    call_handling: VoiceCallHandlingConfigurationSchema,
  })
  .strict();
export type UpdateVoiceCallHandlingRequest = z.infer<
  typeof UpdateVoiceCallHandlingRequestSchema
>;

export const VoiceCallDirectionSchema = z.enum(["inbound", "outbound"]);
export type VoiceCallDirection = z.infer<typeof VoiceCallDirectionSchema>;

export const VoiceCallStatusSchema = z.enum([
  "queued",
  "initiated",
  "ringing",
  "in_progress",
  "completed",
  "busy",
  "failed",
  "no_answer",
  "cancelled",
]);
export type VoiceCallStatus = z.infer<typeof VoiceCallStatusSchema>;

export const InitiateVoiceCallRequestSchema = z
  .object({
    voice_account_id: VoiceAccountIdSchema,
    to_phone_number: E164PhoneNumberSchema,
  })
  .strict();
export type InitiateVoiceCallRequest = z.infer<
  typeof InitiateVoiceCallRequestSchema
>;

export const VoiceCallSchema = z
  .object({
    provider_call_reference: ExternalReferenceSchema,
    voice_account_id: VoiceAccountIdSchema,
    direction: VoiceCallDirectionSchema,
    status: VoiceCallStatusSchema,
    from_phone_number: E164PhoneNumberSchema,
    to_phone_number: E164PhoneNumberSchema,
    started_at: IsoTimestampSchema.nullable(),
    ended_at: IsoTimestampSchema.nullable(),
  })
  .strict();
export type VoiceCall = z.infer<typeof VoiceCallSchema>;

export const VoiceAccountHealthSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    checked_at: IsoTimestampSchema,
    latency_ms: z.number().int().nonnegative(),
  })
  .strict();
export type VoiceAccountHealth = z.infer<typeof VoiceAccountHealthSchema>;

export const VoiceCapabilitiesSchema = z
  .object({
    supports_inbound_calls: z.boolean(),
    supports_outbound_calls: z.boolean(),
    supports_status_callbacks: z.boolean(),
    supported_languages: z.array(Bcp47LanguageTagSchema),
    supported_voice_styles: z.array(z.string().trim().min(1).max(64)),
  })
  .strict();
export type VoiceCapabilities = z.infer<typeof VoiceCapabilitiesSchema>;

export const VoiceNumberBindingListSchema = z
  .object({
    data: z.array(VoiceNumberBindingSchema),
    page: z
      .object({
        next_cursor: z.string().nullable(),
        has_more: z.boolean(),
        limit: z.number().int().min(1).max(200),
      })
      .strict(),
  })
  .strict();
export type VoiceNumberBindingList = z.infer<typeof VoiceNumberBindingListSchema>;
