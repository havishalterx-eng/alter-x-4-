import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { ProblemDetails } from "@alterx/contracts";
import { WebhookDeliveryRejectedError } from "./trigger-binding.service";
import {
  TriggerBindingNotFoundError,
  TriggerBindingValidationError,
  TriggerBindingWorkspaceMismatchError,
  TriggerNotBindableError,
  WebhookEndpointNotFoundError,
} from "./validation";

export function mapBindingError(
  error: unknown,
  requestUrl: string | undefined,
): HttpException {
  if (
    error instanceof TriggerBindingNotFoundError ||
    error instanceof WebhookEndpointNotFoundError
  ) {
    return new HttpException(
      problem({
        status: 404,
        title: "Not Found",
        detail: error.message,
        errorCode: "TRIGGER_BINDING_NOT_FOUND",
        documentationKey: "trigger-bindings.not-found",
        requestUrl,
      }),
      404,
    );
  }
  if (error instanceof TriggerBindingWorkspaceMismatchError) {
    // 404, not 403: a caller in the wrong workspace must not be able to
    // confirm that a trigger id exists somewhere else in the tenant.
    return new HttpException(
      problem({
        status: 404,
        title: "Not Found",
        detail: "Trigger binding target was not found in this workspace",
        errorCode: "TRIGGER_BINDING_NOT_FOUND",
        documentationKey: "trigger-bindings.not-found",
        requestUrl,
      }),
      404,
    );
  }
  if (error instanceof TriggerNotBindableError) {
    return new HttpException(
      problem({
        status: 409,
        title: "Conflict",
        detail: error.message,
        errorCode: "TRIGGER_NOT_BINDABLE",
        documentationKey: "trigger-bindings.not-bindable",
        requestUrl,
      }),
      409,
    );
  }
  if (error instanceof TriggerBindingValidationError) {
    return new HttpException(
      problem({
        status: 400,
        title: "Bad Request",
        detail: error.message,
        errorCode: "TRIGGER_BINDING_VALIDATION_FAILED",
        documentationKey: "trigger-bindings.validation-failed",
        requestUrl,
      }),
      400,
    );
  }
  if (error instanceof HttpException) {
    return error;
  }
  return new HttpException(
    problem({
      status: 500,
      title: "Internal Server Error",
      detail: "Trigger binding request could not be completed",
      errorCode: "TRIGGER_BINDING_INTERNAL_ERROR",
      documentationKey: "trigger-bindings.internal-error",
      requestUrl,
    }),
    500,
  );
}

/**
 * Every inbound-delivery rejection collapses to one opaque 401. The specific
 * reason (unknown token / skew / bad signature) is deliberately withheld so
 * the public endpoint cannot be probed as an oracle, and is never written to
 * a response body.
 */
export function mapDeliveryError(
  error: unknown,
  requestUrl: string | undefined,
): HttpException {
  if (error instanceof WebhookDeliveryRejectedError) {
    return new HttpException(
      problem({
        status: 401,
        title: "Unauthorized",
        detail: "Webhook signature verification failed",
        errorCode: "WEBHOOK_SIGNATURE_INVALID",
        documentationKey: "trigger-bindings.signature-invalid",
        requestUrl,
      }),
      401,
    );
  }
  if (error instanceof HttpException) {
    return error;
  }
  return new HttpException(
    problem({
      status: 500,
      title: "Internal Server Error",
      detail: "Webhook delivery could not be processed",
      errorCode: "WEBHOOK_DELIVERY_INTERNAL_ERROR",
      documentationKey: "trigger-bindings.delivery-error",
      requestUrl,
    }),
    500,
  );
}

function problem(input: {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly errorCode: string;
  readonly documentationKey: string;
  readonly requestUrl: string | undefined;
}): ProblemDetails {
  return {
    type: `https://alter.dev/problems/${input.documentationKey}`,
    title: input.title,
    status: input.status,
    detail: input.detail,
    instance: input.requestUrl?.startsWith("/") ? input.requestUrl : "/",
    error_code: input.errorCode,
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: input.documentationKey,
  };
}

function prefixedUuidV7(prefix: "trc" | "req"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}` as `${typeof prefix}_${string}`;
}
