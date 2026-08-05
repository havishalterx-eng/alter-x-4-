// ENG-BINDING, plug-and-play surface.
//
// Drop the feature into any Nest host with three lines: construct a store,
// construct the service, register the three controllers.
//
//   const store = new PostgresTriggerBindingStore(orchestrationStore);
//   const service = new TriggerBindingService(store, secretsProvider, {
//     webhookBaseUrl: "https://hooks.example.com",
//   });
//   // controllers: [...TRIGGER_BINDING_CONTROLLERS]
//
// Everything the feature needs from the outside world is a port:
// TriggerBindingStore (persistence) and MutableSecretsProvider (secret
// material). Swap either without touching the service.
export { TriggerBindingController, WebhookEndpointController } from "./trigger-binding.controller";
export { IntegrationWebhookController } from "./integration-webhook.controller";
export {
  TriggerBindingService,
  WebhookDeliveryRejectedError,
  type BindTriggerRequest,
  type TriggerBindingServiceOptions,
  type WebhookDeliveryRequest,
} from "./trigger-binding.service";
export {
  PostgresTriggerBindingStore,
  type OrchestrationTenantStore,
} from "./postgres-trigger-binding.store";
export {
  InMemoryTriggerBindingStore,
  type SeedTrigger,
} from "./in-memory-trigger-binding.store";
export {
  signWebhookRequest,
  signaturePayload,
  verifyWebhookRequest,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type SignatureRejection,
  type SignatureVerdict,
} from "./webhook-signature";
export {
  TriggerBindingNotFoundError,
  TriggerBindingValidationError,
  TriggerBindingWorkspaceMismatchError,
  TriggerNotBindableError,
  WebhookEndpointNotFoundError,
} from "./validation";
export { mapBindingError, mapDeliveryError } from "./problem";
export type {
  TriggerBindingRecord,
  TriggerBindingStore,
  WebhookEndpointRecord,
  WebhookRouting,
  WebhookSecretRecord,
} from "./types";
export { loadTriggerBindingEnvironment } from "./config";

import { IntegrationWebhookController } from "./integration-webhook.controller";
import {
  TriggerBindingController,
  WebhookEndpointController,
} from "./trigger-binding.controller";

/** Register these three in a Nest module's `controllers` array. */
export const TRIGGER_BINDING_CONTROLLERS = [
  TriggerBindingController,
  WebhookEndpointController,
  IntegrationWebhookController,
] as const;
