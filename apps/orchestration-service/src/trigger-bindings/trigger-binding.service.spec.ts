import { createMockMutableSecretsProvider } from "@alterx/shared-clients";
import { WEBHOOK_SECRET_ROTATION_POLICY } from "@alterx/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTriggerBindingStore } from "./in-memory-trigger-binding.store";
import {
  TriggerBindingService,
  WebhookDeliveryRejectedError,
} from "./trigger-binding.service";
import {
  TriggerBindingNotFoundError,
  TriggerBindingValidationError,
  TriggerBindingWorkspaceMismatchError,
  TriggerNotBindableError,
  WebhookEndpointNotFoundError,
} from "./validation";
import { signWebhookRequest } from "./webhook-signature";

// ENGINE-FIX-P3-20: these three were bare UUIDs, matching validation.ts's
// old (wrong) bare-UUID tenantId/workspaceId check instead of the real
// ten_/ws_ prefixed convention every actual tenantId/workspaceId in this
// system uses -- fixed alongside that validation bug.
const TENANT_ID = "ten_3f2c1b90-4d5e-7a1b-8c2d-0e1f2a3b4c5d";
const WORKSPACE_ID = "ws_5a4b3c2d-1e0f-7a9b-8c7d-6e5f4a3b2c1d";
const OTHER_WORKSPACE_ID = "ws_9a8b7c6d-5e4f-7a3b-8c2d-1e0f9a8b7c6d";
const TRIGGER_ID = "trg_11111111-2222-7333-8444-555555555555";
const CRON_TRIGGER_ID = "trg_66666666-7777-7888-8999-aaaaaaaaaaaa";
const INTEGRATION_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_INTEGRATION_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

function createService(): {
  readonly service: TriggerBindingService;
  readonly store: InMemoryTriggerBindingStore;
  readonly secrets: ReturnType<typeof createMockMutableSecretsProvider>;
} {
  const store = new InMemoryTriggerBindingStore([
    {
      tenantId: TENANT_ID,
      triggerId: TRIGGER_ID,
      workspaceId: WORKSPACE_ID,
      type: "webhook",
    },
    {
      tenantId: TENANT_ID,
      triggerId: CRON_TRIGGER_ID,
      workspaceId: WORKSPACE_ID,
      type: "cron",
    },
  ]);
  const secrets = createMockMutableSecretsProvider({ secrets: {} });
  const service = new TriggerBindingService(store, secrets, {
    webhookBaseUrl: "https://hooks.example.com",
  });
  return { service, store, secrets };
}

async function bind(
  service: TriggerBindingService,
  integrationId = INTEGRATION_ID,
) {
  return service.bindTrigger({
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    triggerId: TRIGGER_ID,
    integrationId,
    config: { eventTypes: ["issue.opened"] },
  });
}

async function endpointFor(
  service: TriggerBindingService,
  integrationId = INTEGRATION_ID,
) {
  return service.getEndpointForIntegration(
    TENANT_ID,
    WORKSPACE_ID,
    integrationId,
  );
}

/** Signs and delivers a request with an explicitly supplied secret. */
async function deliver(
  service: TriggerBindingService,
  store: InMemoryTriggerBindingStore,
  endpointId: string,
  secret: string,
  body: Record<string, unknown> = { type: "issue.opened" },
) {
  const endpoint = await store.findEndpointById(TENANT_ID, endpointId);
  const rawBody = Buffer.from(JSON.stringify(body), "utf8");
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return service.receiveDelivery({
    pathToken: endpoint!.pathToken,
    rawBody,
    signatureHeader: signWebhookRequest(timestamp, rawBody, secret),
    timestampHeader: timestamp,
  });
}

describe("TriggerBindingService binding", () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it("binds a webhook trigger to an integration connection", async () => {
    const binding = await bind(context.service);

    expect(binding.triggerId).toBe(TRIGGER_ID);
    expect(binding.integrationId).toBe(INTEGRATION_ID);
    expect(binding.workspaceId).toBe(WORKSPACE_ID);
    expect(binding.status).toBe("active");
    expect(binding.webhookEndpointId).toMatch(/^whe_/);
  });

  it("rejects a binding whose workspace does not own the trigger", async () => {
    await expect(
      context.service.bindTrigger({
        tenantId: TENANT_ID,
        workspaceId: OTHER_WORKSPACE_ID,
        triggerId: TRIGGER_ID,
        integrationId: INTEGRATION_ID,
        config: { eventTypes: ["issue.opened"] },
      }),
    ).rejects.toBeInstanceOf(TriggerBindingWorkspaceMismatchError);
  });

  it("rejects binding a non-webhook trigger", async () => {
    await expect(
      context.service.bindTrigger({
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        triggerId: CRON_TRIGGER_ID,
        integrationId: INTEGRATION_ID,
        config: { eventTypes: ["issue.opened"] },
      }),
    ).rejects.toBeInstanceOf(TriggerNotBindableError);
  });

  it("rejects an untyped or empty binding config", async () => {
    await expect(
      context.service.bindTrigger({
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        triggerId: TRIGGER_ID,
        integrationId: INTEGRATION_ID,
        config: { eventTypes: [] },
      }),
    ).rejects.toBeInstanceOf(TriggerBindingValidationError);
  });

  it("rejects an unknown trigger", async () => {
    await expect(
      context.service.bindTrigger({
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        triggerId: "trg_99999999-9999-7999-8999-999999999999",
        integrationId: INTEGRATION_ID,
        config: { eventTypes: ["issue.opened"] },
      }),
    ).rejects.toBeInstanceOf(TriggerBindingNotFoundError);
  });

  it("rebinding the same pair updates in place instead of duplicating", async () => {
    const first = await bind(context.service);
    const second = await context.service.bindTrigger({
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      triggerId: TRIGGER_ID,
      integrationId: INTEGRATION_ID,
      config: { eventTypes: ["issue.closed"] },
    });

    expect(second.id).toBe(first.id);
    const listed = await context.service.listBindings(TENANT_ID, TRIGGER_ID);
    expect(listed.bindings).toHaveLength(1);
    expect(listed.bindings[0]!.config.eventTypes).toEqual(["issue.closed"]);
  });

  it("disables a binding", async () => {
    const binding = await bind(context.service);
    const disabled = await context.service.disableBinding(
      TENANT_ID,
      TRIGGER_ID,
      binding.id,
    );
    expect(disabled.status).toBe("disabled");
  });
});

describe("webhook endpoints", () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it("mints a unique, unguessable endpoint per integration", async () => {
    await bind(context.service, INTEGRATION_ID);
    await bind(context.service, OTHER_INTEGRATION_ID);

    const first = await endpointFor(context.service, INTEGRATION_ID);
    const second = await endpointFor(context.service, OTHER_INTEGRATION_ID);

    expect(first.id).not.toBe(second.id);
    expect(first.url).not.toBe(second.url);

    const firstToken = first.url.split("/").pop()!;
    const secondToken = second.url.split("/").pop()!;
    expect(firstToken).not.toBe(secondToken);
    // 32 CSPRNG bytes, base64url -> 43 characters.
    expect(firstToken).toHaveLength(43);
    expect(secondToken).toHaveLength(43);
  });

  it("reuses one endpoint across every binding onto the same integration", async () => {
    const first = await bind(context.service, INTEGRATION_ID);
    const second = await context.service.bindTrigger({
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      triggerId: TRIGGER_ID,
      integrationId: INTEGRATION_ID,
      config: { eventTypes: ["issue.closed"] },
    });
    expect(second.webhookEndpointId).toBe(first.webhookEndpointId);
  });

  it("publishes the signing contract but never the secret", async () => {
    await bind(context.service);
    const endpoint = await endpointFor(context.service);

    expect(endpoint.signatureAlgorithm).toBe("hmac-sha256");
    expect(endpoint.signaturePayloadTemplate).toBe("{timestamp}.{rawBody}");
    expect(endpoint.activeSecretVersion).toBe(1);
    expect(endpoint.secretRotatedAt).toBeNull();
    expect(endpoint.rotationPolicy).toEqual(WEBHOOK_SECRET_ROTATION_POLICY);
  });

  it("404s for an integration with no endpoint", async () => {
    await expect(
      endpointFor(context.service, OTHER_INTEGRATION_ID),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
  });
});

describe("delivery verification", () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it("accepts a correctly signed delivery and reports matched bindings", async () => {
    const binding = await bind(context.service);
    const active = await context.store.findActiveSecret(
      TENANT_ID,
      binding.webhookEndpointId,
    );
    const secret = await context.secrets.getSecret(active!.secretRef);

    const result = await deliver(
      context.service,
      context.store,
      binding.webhookEndpointId,
      secret,
    );

    expect(result.accepted).toBe(true);
    expect(result.matchedBindingIds).toEqual([binding.id]);
  });

  it("rejects a delivery signed with the wrong secret", async () => {
    const binding = await bind(context.service);
    await expect(
      deliver(
        context.service,
        context.store,
        binding.webhookEndpointId,
        "not-the-signing-secret",
      ),
    ).rejects.toBeInstanceOf(WebhookDeliveryRejectedError);
  });

  it("rejects a delivery whose timestamp is outside the skew window", async () => {
    const binding = await bind(context.service);
    const active = await context.store.findActiveSecret(
      TENANT_ID,
      binding.webhookEndpointId,
    );
    const secret = await context.secrets.getSecret(active!.secretRef);
    const endpoint = await context.store.findEndpointById(
      TENANT_ID,
      binding.webhookEndpointId,
    );
    const rawBody = Buffer.from(JSON.stringify({ type: "issue.opened" }));
    const stale = String(Math.floor(Date.now() / 1_000) - 4_000);

    await expect(
      context.service.receiveDelivery({
        pathToken: endpoint!.pathToken,
        rawBody,
        signatureHeader: signWebhookRequest(stale, rawBody, secret),
        timestampHeader: stale,
      }),
    ).rejects.toBeInstanceOf(WebhookDeliveryRejectedError);
  });

  it("rejects an unknown path token", async () => {
    await expect(
      context.service.receiveDelivery({
        pathToken: "not-a-real-token",
        rawBody: Buffer.from("{}"),
        signatureHeader: "sha256=00",
        timestampHeader: String(Math.floor(Date.now() / 1_000)),
      }),
    ).rejects.toBeInstanceOf(WebhookDeliveryRejectedError);
  });

  it("does not match a binding whose event type is not configured", async () => {
    const binding = await bind(context.service);
    const active = await context.store.findActiveSecret(
      TENANT_ID,
      binding.webhookEndpointId,
    );
    const secret = await context.secrets.getSecret(active!.secretRef);

    const result = await deliver(
      context.service,
      context.store,
      binding.webhookEndpointId,
      secret,
      { type: "issue.deleted" },
    );
    expect(result.matchedBindingIds).toEqual([]);
  });
});

describe("secret rotation -- declared model: hard cutover, zero overlap", () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it("real-invalidates the old secret immediately", async () => {
    const binding = await bind(context.service);
    const endpointId = binding.webhookEndpointId;
    const before = await context.store.findActiveSecret(TENANT_ID, endpointId);
    const oldSecret = await context.secrets.getSecret(before!.secretRef);

    // Sanity: the old secret verifies BEFORE rotation, so the assertion
    // after rotation is about rotation and not about a broken fixture.
    await expect(
      deliver(context.service, context.store, endpointId, oldSecret),
    ).resolves.toMatchObject({ accepted: true });

    const rotation = await context.service.rotateSecret(TENANT_ID, endpointId);

    expect(rotation.rotationPolicy).toEqual(WEBHOOK_SECRET_ROTATION_POLICY);
    expect(rotation.rotationPolicy.overlapSeconds).toBe(0);
    expect(rotation.activeSecretVersion).toBe(2);
    expect(rotation.previousSecretVersion).toBe(1);
    // Zero overlap: invalidation happens at the rotation instant.
    expect(rotation.previousSecretInvalidatedAt).toBe(rotation.rotatedAt);

    await expect(
      deliver(context.service, context.store, endpointId, oldSecret),
    ).rejects.toBeInstanceOf(WebhookDeliveryRejectedError);
  });

  it("accepts deliveries signed with the new secret", async () => {
    const binding = await bind(context.service);
    const endpointId = binding.webhookEndpointId;
    await context.service.rotateSecret(TENANT_ID, endpointId);

    const active = await context.store.findActiveSecret(TENANT_ID, endpointId);
    const newSecret = await context.secrets.getSecret(active!.secretRef);

    await expect(
      deliver(context.service, context.store, endpointId, newSecret),
    ).resolves.toMatchObject({ accepted: true });
  });

  it("deletes the old secret material from the provider", async () => {
    const binding = await bind(context.service);
    const endpointId = binding.webhookEndpointId;
    const before = await context.store.findActiveSecret(TENANT_ID, endpointId);

    await context.service.rotateSecret(TENANT_ID, endpointId);

    // Not merely flagged revoked in the database: the material is gone, so
    // even a caller holding the old reference cannot resolve it.
    await expect(
      context.secrets.getSecret(before!.secretRef),
    ).rejects.toThrow();
  });

  it("leaves exactly one active secret row after repeated rotations", async () => {
    const binding = await bind(context.service);
    const endpointId = binding.webhookEndpointId;
    await context.service.rotateSecret(TENANT_ID, endpointId);
    await context.service.rotateSecret(TENANT_ID, endpointId);
    const third = await context.service.rotateSecret(TENANT_ID, endpointId);

    expect(third.activeSecretVersion).toBe(4);
    const active = context.store.secretRows.filter(
      (row) => row.endpointId === endpointId && row.status === "active",
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe(4);
  });

  it("rejects rotation for an unknown endpoint", async () => {
    await expect(
      context.service.rotateSecret(
        TENANT_ID,
        "whe_00000000-0000-7000-8000-000000000000",
      ),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
  });

  it("never returns secret material in any response", async () => {
    const binding = await bind(context.service);
    const endpointId = binding.webhookEndpointId;
    const active = await context.store.findActiveSecret(TENANT_ID, endpointId);
    const secretValue = await context.secrets.getSecret(active!.secretRef);

    const endpoint = await endpointFor(context.service);
    const rotation = await context.service.rotateSecret(TENANT_ID, endpointId);
    const listed = await context.service.listBindings(TENANT_ID, TRIGGER_ID);

    for (const payload of [binding, endpoint, rotation, listed]) {
      const serialised = JSON.stringify(payload);
      expect(serialised).not.toContain(secretValue);
      expect(serialised).not.toContain("secretRef");
      expect(serialised).not.toContain("secret_ref");
      expect(serialised).not.toContain("pathToken");
    }
  });
});
