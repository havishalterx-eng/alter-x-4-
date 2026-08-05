import { Controller, Headers, HttpCode, Param, Post, Req } from "@nestjs/common";
import { Public } from "@alterx/auth";
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookDeliveryAccepted,
} from "@alterx/contracts";
import { mapDeliveryError } from "./problem";
import {
  TriggerBindingService,
  WebhookDeliveryRejectedError,
} from "./trigger-binding.service";

interface RawBodyRequest {
  readonly rawBody?: Buffer;
  readonly url?: string;
}

/**
 * Public inbound receiver. Authenticated by HMAC signature over the raw body,
 * not by a platform token -- hence @Public(). The URL's path token is
 * unguessable but is NOT the authenticator: a delivery without a valid
 * signature is rejected even with the correct URL.
 *
 * The route is deliberately absent from the v1 OpenAPI document, which
 * registers M2M/actor-token security on every operation it describes. Its
 * wire contract (headers, algorithm, signed payload template) is declared in
 * packages/contracts/src/trigger-bindings.ts.
 */
@Controller("v1/webhooks/integrations")
export class IntegrationWebhookController {
  constructor(private readonly service: TriggerBindingService) {}

  @Post(":pathToken")
  @Public()
  @HttpCode(202)
  async receive(
    @Param("pathToken") pathToken: string,
    @Headers(WEBHOOK_SIGNATURE_HEADER) signature: string | undefined,
    @Headers(WEBHOOK_TIMESTAMP_HEADER) timestamp: string | undefined,
    @Req() request: RawBodyRequest,
  ): Promise<WebhookDeliveryAccepted> {
    // Signature verification must run against the exact pre-parse bytes; a
    // re-serialised parsed body is not guaranteed byte-identical to what the
    // sender signed. No rawBody means nothing verifiable, so: reject.
    if (request.rawBody === undefined) {
      throw mapDeliveryError(
        new WebhookDeliveryRejectedError("missing_signature"),
        request.url,
      );
    }
    try {
      return await this.service.receiveDelivery({
        pathToken,
        rawBody: request.rawBody,
        signatureHeader: signature,
        timestampHeader: timestamp,
      });
    } catch (error: unknown) {
      throw mapDeliveryError(error, request.url);
    }
  }
}
