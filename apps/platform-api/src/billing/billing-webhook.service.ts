import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  BillingEvent,
  BillingProvider,
  JsonValue,
  SecretsProvider,
} from "@alterx/shared-clients";
import type { PoolClient } from "pg";
import {
  CONFIG_PROVIDER,
  ENTITLEMENT_PROVIDER,
  type ConfigProvider,
  type EntitlementAccessState,
  type EntitlementLimits,
  type EntitlementProvider,
} from "../entitlements";
import { PgIdempotencyStore } from "../idempotency";
import { BillingWebhookRepository } from "./billing-webhook.repository";
import { BillingHttpError } from "./problem";
import {
  BILLING_PROVIDER,
  BILLING_SECRETS_PROVIDER,
  BILLING_WEBHOOK_SECRET_REF,
} from "./tokens";

const successEvents = new Set([
  "subscription.activated",
  "subscription.charged",
  "payment.authorized",
  "payment.captured",
  "payment.succeeded",
  "payment_succeeded",
]);
const failedEvents = new Set(["payment.failed", "payment_failed"]);

export interface BillingWebhookResult {
  accepted: true;
  event_id: string;
  state: EntitlementAccessState;
  replayed: boolean;
}

@Injectable()
export class BillingWebhookService {
  constructor(
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProvider,
    @Inject(BILLING_SECRETS_PROVIDER)
    private readonly secrets: SecretsProvider,
    @Inject(BILLING_WEBHOOK_SECRET_REF)
    private readonly webhookSecretRef: string,
    private readonly idempotency: PgIdempotencyStore,
    private readonly repository: BillingWebhookRepository,
    @Inject(ENTITLEMENT_PROVIDER)
    private readonly entitlements: EntitlementProvider,
    @Inject(CONFIG_PROVIDER)
    private readonly config: ConfigProvider,
  ) {}

  private readonly now = (): Date => new Date();

  async receive(
    providerId: string,
    rawBody: Uint8Array,
    signature: string,
    providerEventId: string,
  ): Promise<BillingWebhookResult> {
    const instance = `/api/v1/billing/webhooks/${encodeURIComponent(providerId)}`;
    if (providerId !== this.provider.metadata.providerId) {
      throw new BillingHttpError(
        404,
        "BILLING_PROVIDER_NOT_FOUND",
        "Billing provider not found",
        instance,
      );
    }

    const secret = await this.getWebhookSecret(instance);
    if (
      !signature ||
      !this.provider.verifyWebhookSignature(rawBody, signature, secret)
    ) {
      throw new BillingHttpError(
        401,
        "BILLING_WEBHOOK_UNAUTHORIZED",
        "Webhook authentication failed",
        instance,
      );
    }

    if (!providerEventId) {
      throw new BillingHttpError(
        400,
        "BILLING_WEBHOOK_EVENT_ID_REQUIRED",
        "Webhook event id is required",
        instance,
      );
    }
    const event = {
      ...this.parseEvent(rawBody, instance),
      id: providerEventId,
    };
    const context = eventContext(event, instance);
    const fingerprint = createHash("sha256").update(rawBody).digest("hex");
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        key: `${providerId}:${event.id}`,
        fingerprint,
        instance,
      },
      async () => ({
        status: 202,
        body: await this.process(providerId, event, context),
      }),
    );
    const body = result.body as Omit<BillingWebhookResult, "replayed">;
    return { ...body, replayed: result.replayed };
  }

  private async process(
    providerId: string,
    event: BillingEvent,
    context: EventContext,
  ): Promise<Omit<BillingWebhookResult, "replayed">> {
    return this.repository.transaction(context.tenantId, async (client) => {
      const inserted = await this.repository.insertEvent(client, {
        tenantId: context.tenantId,
        providerId,
        providerEventId: event.id,
        type: event.type,
        payload: sanitizePayload(event.payload),
      });
      const current = await this.repository.getDunningState(
        client,
        context.tenantId,
      );
      if (!inserted) {
        return {
          accepted: true,
          event_id: event.id,
          state: current.state,
        };
      }

      const next = successEvents.has(event.type)
        ? await this.applySuccess(client, event, context, current)
        : failedEvents.has(event.type)
          ? await this.applyFailure(client, event, current, context.tenantId)
          : current;

      await this.repository.markEventProcessed(
        client,
        context.tenantId,
        event.id,
      );
      return {
        accepted: true,
        event_id: event.id,
        state: next.state,
      };
    });
  }

  private async applySuccess(
    client: PoolClient,
    event: BillingEvent,
    context: EventContext,
    current: DunningState,
  ): Promise<DunningState> {
    const plan = context.plan ?? current.currentPlan;
    if (!plan) {
      throw new Error("Billing success event has no plan");
    }
    await this.entitlements.createEntitlement(
      context.tenantId,
      plan,
      client,
      { accessState: "active" },
    );
    const next: DunningState = {
      state: "active",
      currentPlan: plan,
      firstFailedAt: null,
    };
    await this.persistTransition(
      client,
      context.tenantId,
      event.id,
      current,
      next,
      "payment_succeeded",
    );
    return next;
  }

  private async applyFailure(
    client: PoolClient,
    event: BillingEvent,
    current: DunningState,
    tenantId: string,
  ): Promise<DunningState> {
    if (!current.currentPlan) {
      throw new Error("Billing failure event has no current plan");
    }
    const now = this.now();
    const config = await this.config.getDunningConfig();
    const firstFailedAt = current.firstFailedAt ?? now;
    const elapsedSeconds = (now.getTime() - firstFailedAt.getTime()) / 1_000;
    const state: EntitlementAccessState =
      current.state === "active"
        ? "grace"
        : elapsedSeconds >= config.suspensionThresholdSeconds
          ? "suspended"
          : elapsedSeconds >= config.gracePeriodSeconds
            ? "limited"
            : "grace";
    const next: DunningState = {
      state,
      currentPlan: current.currentPlan,
      firstFailedAt,
    };

    if (state !== current.state && state === "limited") {
      await this.entitlements.createEntitlement(
        tenantId,
        current.currentPlan,
        client,
        {
          accessState: "limited",
          limits: config.limitedStateLimits,
        },
      );
    }
    if (state !== current.state && state === "suspended") {
      await this.entitlements.createEntitlement(
        tenantId,
        current.currentPlan,
        client,
        {
          accessState: "suspended",
          limits: zeroLimits(config.limitedStateLimits),
        },
      );
    }
    if (state !== current.state) {
      await this.persistTransition(
        client,
        tenantId,
        event.id,
        current,
        next,
        "payment_failed",
      );
    }
    return next;
  }

  private async persistTransition(
    client: PoolClient,
    tenantId: string,
    eventId: string,
    current: DunningState,
    next: DunningState,
    reason: string,
  ): Promise<void> {
    await this.repository.saveDunningState(client, tenantId, next);
    await this.repository.auditTransition(client, {
      tenantId,
      providerEventId: eventId,
      fromState: current.state,
      toState: next.state,
      reason,
    });
  }

  private parseEvent(rawBody: Uint8Array, instance: string): BillingEvent {
    try {
      return this.provider.parseWebhookEvent(rawBody);
    } catch {
      throw new BillingHttpError(
        400,
        "BILLING_WEBHOOK_INVALID",
        "Webhook payload is invalid",
        instance,
      );
    }
  }

  private async getWebhookSecret(instance: string): Promise<string> {
    try {
      return await this.secrets.getSecret(this.webhookSecretRef);
    } catch {
      throw new BillingHttpError(
        502,
        "BILLING_WEBHOOK_SECRET_UNAVAILABLE",
        "Webhook verification is unavailable",
        instance,
      );
    }
  }
}

interface EventContext {
  tenantId: string;
  plan: string | null;
}

type DunningState = {
  state: EntitlementAccessState;
  currentPlan: string | null;
  firstFailedAt: Date | null;
};

function eventContext(event: BillingEvent, instance: string): EventContext {
  const root = record(event.payload);
  const subscription = nestedEntity(root, "subscription");
  const payment = nestedEntity(root, "payment");
  const notes =
    recordOrUndefined(subscription?.notes) ??
    recordOrUndefined(payment?.notes) ??
    recordOrUndefined(root.notes);
  const tenantId = nonEmptyString(notes?.tenant_id ?? root.tenant_id);
  if (!tenantId) {
    throw new BillingHttpError(
      400,
      "BILLING_WEBHOOK_INVALID",
      "Webhook tenant context is missing",
      instance,
    );
  }
  return {
    tenantId,
    plan: nonEmptyString(subscription?.plan_id ?? notes?.plan_id ?? root.plan_id),
  };
}

function nestedEntity(
  root: Record<string, JsonValue>,
  key: string,
): Record<string, JsonValue> | undefined {
  const wrapper = recordOrUndefined(root.payload)?.[key] ?? root[key];
  return recordOrUndefined(recordOrUndefined(wrapper)?.entity);
}

function record(value: JsonValue): Record<string, JsonValue> {
  return recordOrUndefined(value) ?? {};
}

function recordOrUndefined(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

function nonEmptyString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const secretKeys = new Set([
  "card_number",
  "cvv",
  "cvc",
  "provider_token",
  "api_key",
  "secret",
]);

function sanitizePayload(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        secretKeys.has(key.toLowerCase())
          ? "[REDACTED]"
          : sanitizePayload(entry),
      ]),
    );
  }
  return value;
}

function zeroLimits(template: EntitlementLimits): EntitlementLimits {
  return Object.fromEntries(
    Object.keys(template).map((key) => [key, 0]),
  ) as unknown as EntitlementLimits;
}
