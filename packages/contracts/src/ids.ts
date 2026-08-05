import { z } from "./zod";

const UUID_V7_BODY =
  "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function prefixedUuidV7(prefix: string): z.ZodString {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_${UUID_V7_BODY}$`, "i"), {
      message: `Expected a ${prefix}_ prefixed UUIDv7`,
    });
}

export const TenantIdSchema = prefixedUuidV7("ten");
export const WorkspaceIdSchema = prefixedUuidV7("ws");
export const UserIdSchema = prefixedUuidV7("usr");
export const WorkflowIdSchema = prefixedUuidV7("wf");
export const WorkflowVersionIdSchema = prefixedUuidV7("wfv");
export const ProjectIdSchema = prefixedUuidV7("prj");
export const RunIdSchema = prefixedUuidV7("run");
export const NodeExecutionIdSchema = prefixedUuidV7("node");
export const EventIdSchema = prefixedUuidV7("evt");
export const TriggerIdSchema = prefixedUuidV7("trg");
export const TriggerVersionIdSchema = prefixedUuidV7("trgv");
export const AgentIdSchema = prefixedUuidV7("agt");
export const PolicyIdSchema = prefixedUuidV7("pol");
export const PolicyPromotionIdSchema = prefixedUuidV7("prom");
export const DriftScoreIdSchema = prefixedUuidV7("drift");
export const CostIdSchema = prefixedUuidV7("cst");
// OUT-1: doc 04 SS6 cost_db.billing_rollups.id has no prefix comment in the
// spec table; "bru" chosen to follow the existing per-entity prefix
// convention (additive contract change, doc 04 line 5 permits this).
export const BillingRollupIdSchema = prefixedUuidV7("bru");
export const AuditIdSchema = prefixedUuidV7("aud");
export const DocumentIdSchema = prefixedUuidV7("doc");
export const ArtifactIdSchema = prefixedUuidV7("art");
export const DeploymentIdSchema = prefixedUuidV7("dep");
export const EnvironmentIdSchema = prefixedUuidV7("env");
export const ApprovalIdSchema = prefixedUuidV7("apr");
export const ConversationIdSchema = prefixedUuidV7("cnv");
export const MemoryIdSchema = prefixedUuidV7("mem");
// Voice accounts own a tenant/workspace phone-number binding. The binding is
// deliberately distinct from a provider account reference, which remains an
// opaque external identifier held through SecretsProvider.
export const VoiceAccountIdSchema = prefixedUuidV7("voc");

export const VerificationResultIdSchema = prefixedUuidV7("ver");
export const RecoveryActionIdSchema = prefixedUuidV7("rec");
export const ClarificationIdSchema = prefixedUuidV7("clr");
export const EscalationIdSchema = prefixedUuidV7("esc");
export const TraceIdSchema = prefixedUuidV7("trc");
export const RequestIdSchema = prefixedUuidV7("req");

// ADS Core (KNOW-2, doc 04 §9). DocumentIdSchema ("doc") already existed above.
export const ScopeIdSchema = prefixedUuidV7("scp");
export const SourceIdSchema = prefixedUuidV7("src");
export const ChunkIdSchema = prefixedUuidV7("chk");
export const RecordIdSchema = prefixedUuidV7("brec");
export const MemoryNamespaceIdSchema = prefixedUuidV7("mns");
export const IngestionJobIdSchema = prefixedUuidV7("ing");
export const RetrievalAuditIdSchema = prefixedUuidV7("rta");

// ENG-BINDING. Trigger-to-integration binding, the webhook endpoint that a
// binding provisions, and that endpoint's signing-secret record.
export const TriggerBindingIdSchema = prefixedUuidV7("tbn");
export const WebhookEndpointIdSchema = prefixedUuidV7("whe");
export const WebhookEndpointSecretIdSchema = prefixedUuidV7("whs");

// An integration connection is owned by platform-api's `oauth_connections`
// table, which mints a bare (non-prefixed) UUID -- see
// apps/platform-api/src/integrations/integration.service.ts's callback().
// Engine stores it as an opaque cross-service reference with no foreign key,
// because the two services do not share a database. Shape is validated,
// existence is not.
export const IntegrationConnectionIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, {
    message: "Expected an integration connection UUID",
  });

export const ServiceActorIdSchema = z
  .string()
  .regex(/^svc_[a-z0-9][a-z0-9._:-]{2,127}$/i, {
    message: "Expected an svc_ service actor identifier",
  });

export const ExternalReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .describe(
    "Opaque external reference. It is never an Alter primary key and must not contain a credential value.",
  );

export const IsoTimestampSchema = z.string().datetime({ offset: true });
export const NonEmptyStringSchema = z.string().trim().min(1);
