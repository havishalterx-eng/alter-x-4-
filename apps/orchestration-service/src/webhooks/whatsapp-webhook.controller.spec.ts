import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { ConversationDispatchService } from "./conversation-dispatch.service";
import {
  WhatsappSignatureInvalidError,
  WhatsappVerificationChallengeError,
  WhatsappWebhookService,
} from "./whatsapp-webhook.service";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";

function fakeReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply;
}

function fakeService(
  overrides: Partial<{
    verifyChallenge: WhatsappWebhookService["verifyChallenge"];
    processWebhook: WhatsappWebhookService["processWebhook"];
    tenantId: string;
    workspaceId: string;
  }> = {},
): WhatsappWebhookService {
  return {
    verifyChallenge:
      overrides.verifyChallenge ?? vi.fn(() => "the-challenge"),
    processWebhook:
      overrides.processWebhook ??
      vi.fn(async () => ({
        received: 0,
        persisted: 0,
        duplicates: 0,
        messages: [],
      })),
    tenantId: overrides.tenantId ?? "ten_a",
    workspaceId: overrides.workspaceId ?? "ws_a",
  } as unknown as WhatsappWebhookService;
}

function fakeDispatchService(
  overrides: Partial<{
    dispatchInboundMessages: ConversationDispatchService["dispatchInboundMessages"];
  }> = {},
): ConversationDispatchService {
  return {
    dispatchInboundMessages:
      overrides.dispatchInboundMessages ?? vi.fn(async () => undefined),
  } as unknown as ConversationDispatchService;
}

describe("WhatsappWebhookController.verify", () => {
  it("sends the challenge as plain text on success", () => {
    const service = fakeService();
    const controller = new WhatsappWebhookController(
      service,
      fakeDispatchService(),
    );
    const reply = fakeReply();

    controller.verify(
      "subscribe",
      "token",
      "challenge-abc",
      { url: "/v1/webhooks/whatsapp" },
      reply as never,
    );

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.header).toHaveBeenCalledWith("content-type", "text/plain");
    expect(reply.send).toHaveBeenCalledWith("the-challenge");
  });

  it("maps a verification failure to a 403 ProblemDetails response", () => {
    const service = fakeService({
      verifyChallenge: vi.fn(() => {
        throw new WhatsappVerificationChallengeError();
      }),
    });
    const controller = new WhatsappWebhookController(
      service,
      fakeDispatchService(),
    );
    const reply = fakeReply();

    let caught: unknown;
    try {
      controller.verify(
        "subscribe",
        "wrong-token",
        "challenge-abc",
        { url: "/v1/webhooks/whatsapp" },
        reply as never,
      );
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getStatus()).toBe(403);
    const body = exception.getResponse() as { error_code: string; trace_id: string; request_id: string };
    expect(body.error_code).toBe("WHATSAPP_WEBHOOK_VERIFICATION_FAILED");
    expect(body.trace_id).toMatch(/^trc_/);
    expect(body.request_id).toMatch(/^req_/);
  });
});

describe("WhatsappWebhookController.receive", () => {
  it("rejects the request with 401 when rawBody was never captured", async () => {
    const service = fakeService();
    const controller = new WhatsappWebhookController(
      service,
      fakeDispatchService(),
    );

    await expect(
      controller.receive("sha256=deadbeef", { url: "/v1/webhooks/whatsapp" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("returns the service result on success when there is nothing to dispatch", async () => {
    const processWebhook = vi.fn(async () => ({
      received: 0,
      persisted: 0,
      duplicates: 0,
      messages: [],
    }));
    const service = fakeService({ processWebhook });
    const dispatchInboundMessages = vi.fn(async () => undefined);
    const controller = new WhatsappWebhookController(
      service,
      fakeDispatchService({ dispatchInboundMessages }),
    );
    const rawBody = Buffer.from("{}");

    const result = await controller.receive("sha256=abc", {
      rawBody,
      url: "/v1/webhooks/whatsapp",
    });

    expect(result).toEqual({
      received: 0,
      persisted: 0,
      duplicates: 0,
      messages: [],
    });
    expect(processWebhook).toHaveBeenCalledWith(rawBody, "sha256=abc");
    expect(dispatchInboundMessages).not.toHaveBeenCalled();
  });

  it("dispatches persisted messages to the conversation workflow and returns the service result", async () => {
    const dispatchableMessage = {
      idempotencyKey: "wamid.ABC123",
      subjectId: "16505551234",
      occurredAt: "2026-07-26T12:00:00.000Z",
      payload: { text: { body: "hi" } },
    };
    const processWebhook = vi.fn(async () => ({
      received: 1,
      persisted: 1,
      duplicates: 0,
      messages: [dispatchableMessage],
    }));
    const service = fakeService({ processWebhook });
    const dispatchInboundMessages = vi.fn(async () => undefined);
    const controller = new WhatsappWebhookController(
      service,
      fakeDispatchService({ dispatchInboundMessages }),
    );
    const rawBody = Buffer.from("{}");

    const result = await controller.receive("sha256=abc", {
      rawBody,
      url: "/v1/webhooks/whatsapp",
    });

    expect(result.messages).toEqual([dispatchableMessage]);
    expect(dispatchInboundMessages).toHaveBeenCalledWith(
      "ten_a",
      "ws_a",
      "whatsapp",
      [dispatchableMessage],
    );
  });

  it("maps a dispatch failure to a retryable 500 ProblemDetails response", async () => {
    const processWebhook = vi.fn(async () => ({
      received: 1,
      persisted: 1,
      duplicates: 0,
      messages: [
        {
          idempotencyKey: "wamid.ABC123",
          subjectId: "16505551234",
          occurredAt: "2026-07-26T12:00:00.000Z",
          payload: {},
        },
      ],
    }));
    const service = fakeService({ processWebhook });
    const dispatchInboundMessages = vi.fn(async () => {
      throw new Error("temporal unreachable");
    });
    const controller = new WhatsappWebhookController(
      service,
      fakeDispatchService({ dispatchInboundMessages }),
    );

    let caught: unknown;
    try {
      await controller.receive("sha256=abc", {
        rawBody: Buffer.from("{}"),
        url: "/v1/webhooks/whatsapp",
      });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getStatus()).toBe(500);
    const body = exception.getResponse() as {
      error_code: string;
      retryable: boolean;
      trace_id: string;
      request_id: string;
    };
    expect(body.error_code).toBe("WHATSAPP_WEBHOOK_DISPATCH_FAILED");
    expect(body.retryable).toBe(true);
    expect(body.trace_id).toMatch(/^trc_/);
    expect(body.request_id).toMatch(/^req_/);
  });

  it("maps a signature failure to a 401 ProblemDetails response with a real trace id", async () => {
    const service = fakeService({
      processWebhook: vi.fn(async () => {
        throw new WhatsappSignatureInvalidError();
      }),
    });
    const controller = new WhatsappWebhookController(
      service,
      fakeDispatchService(),
    );

    let caught: unknown;
    try {
      await controller.receive("sha256=abc", {
        rawBody: Buffer.from("{}"),
        url: "/v1/webhooks/whatsapp",
      });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getStatus()).toBe(401);
    const body = exception.getResponse() as { trace_id: string; request_id: string };
    expect(body.trace_id).toMatch(/^trc_[0-9a-f-]{36}$/);
    expect(body.request_id).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(body.trace_id).not.toBe("");
    expect(body.request_id).not.toBe("");
  });
});
