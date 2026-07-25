import { randomUUID } from "node:crypto";
import {
  Controller,
  Get,
  Headers,
  HttpException,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Public } from "@alterx/auth";
import type { ProblemDetails } from "@alterx/contracts";
import {
  WhatsappPayloadValidationError,
  WhatsappReplayError,
  WhatsappSignatureInvalidError,
  WhatsappVerificationChallengeError,
  WhatsappWebhookService,
  type ProcessWebhookResult,
} from "./whatsapp-webhook.service";

interface RawBodyRequest {
  readonly rawBody?: Buffer;
  readonly url?: string;
}

@Controller("v1/webhooks/whatsapp")
export class WhatsappWebhookController {
  constructor(private readonly service: WhatsappWebhookService) {}

  @Get()
  @Public()
  verify(
    @Query("hub.mode") mode: string | undefined,
    @Query("hub.verify_token") token: string | undefined,
    @Query("hub.challenge") challenge: string | undefined,
    @Req() request: RawBodyRequest,
    @Res() reply: FastifyReply,
  ): void {
    try {
      const echoed = this.service.verifyChallenge(mode, token, challenge);
      reply.status(200).header("content-type", "text/plain").send(echoed);
    } catch (error: unknown) {
      throw mapWebhookError(error, request.url);
    }
  }

  @Post()
  @Public()
  async receive(
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Req() request: RawBodyRequest,
  ): Promise<ProcessWebhookResult> {
    if (request.rawBody === undefined) {
      throw mapWebhookError(new WhatsappSignatureInvalidError(), request.url);
    }
    try {
      return await this.service.processWebhook(request.rawBody, signature);
    } catch (error: unknown) {
      throw mapWebhookError(error, request.url);
    }
  }
}

function instanceOrRoot(requestUrl: string | undefined): string {
  return requestUrl?.startsWith("/") ? requestUrl : "/";
}

function mapWebhookError(
  error: unknown,
  requestUrl: string | undefined,
): HttpException {
  if (error instanceof WhatsappSignatureInvalidError) {
    return new HttpException(
      signatureInvalidProblem(requestUrl, error.message),
      401,
    );
  }
  if (error instanceof WhatsappReplayError) {
    return new HttpException(replayProblem(requestUrl, error.message), 401);
  }
  if (error instanceof WhatsappVerificationChallengeError) {
    return new HttpException(
      verificationChallengeProblem(requestUrl, error.message),
      403,
    );
  }
  if (error instanceof WhatsappPayloadValidationError) {
    return new HttpException(
      payloadValidationProblem(requestUrl, error.message),
      400,
    );
  }
  if (error instanceof HttpException) {
    return error;
  }
  return new HttpException(
    internalProblem(requestUrl, "WhatsApp webhook request could not be completed"),
    500,
  );
}

function signatureInvalidProblem(
  requestUrl: string | undefined,
  detail: string,
): ProblemDetails {
  return {
    type: "https://alter.dev/problems/whatsapp-webhook-signature-invalid",
    title: "Unauthorized",
    status: 401,
    detail,
    instance: instanceOrRoot(requestUrl),
    error_code: "WHATSAPP_WEBHOOK_SIGNATURE_INVALID",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "webhooks.whatsapp.signature-invalid",
  };
}

function replayProblem(
  requestUrl: string | undefined,
  detail: string,
): ProblemDetails {
  return {
    type: "https://alter.dev/problems/whatsapp-webhook-replay-rejected",
    title: "Unauthorized",
    status: 401,
    detail,
    instance: instanceOrRoot(requestUrl),
    error_code: "WHATSAPP_WEBHOOK_REPLAY_REJECTED",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "webhooks.whatsapp.replay-rejected",
  };
}

function verificationChallengeProblem(
  requestUrl: string | undefined,
  detail: string,
): ProblemDetails {
  return {
    type: "https://alter.dev/problems/whatsapp-webhook-verification-failed",
    title: "Forbidden",
    status: 403,
    detail,
    instance: instanceOrRoot(requestUrl),
    error_code: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "webhooks.whatsapp.verification-failed",
  };
}

function payloadValidationProblem(
  requestUrl: string | undefined,
  detail: string,
): ProblemDetails {
  return {
    type: "https://alter.dev/problems/whatsapp-webhook-payload-invalid",
    title: "Bad Request",
    status: 400,
    detail,
    instance: instanceOrRoot(requestUrl),
    error_code: "WHATSAPP_WEBHOOK_PAYLOAD_INVALID",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "webhooks.whatsapp.payload-invalid",
  };
}

function internalProblem(
  requestUrl: string | undefined,
  detail: string,
): ProblemDetails {
  return {
    type: "https://alter.dev/problems/whatsapp-webhook-internal",
    title: "Internal Server Error",
    status: 500,
    detail,
    instance: instanceOrRoot(requestUrl),
    error_code: "WHATSAPP_WEBHOOK_INTERNAL_ERROR",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "webhooks.whatsapp.internal-error",
  };
}

function prefixedUuidV7(prefix: "trc" | "req"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}
