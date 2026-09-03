import type {
  ScoreNodeInlineRequest,
  ScoreNodeInlineResponse,
} from "@alterx/contracts";
import type { VerifyServiceHandlerClient } from "@alterx/adapters";

export class VerifyGateError extends Error {
  constructor(
    readonly code: "VERIFICATION_GATE_FAILED" | "VERIFY_SERVICE_UNAVAILABLE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class VerifyGateService {
  constructor(private readonly client: VerifyServiceHandlerClient) {}

  async scoreNodeInline(
    request: ScoreNodeInlineRequest,
  ): Promise<ScoreNodeInlineResponse> {
    try {
      return await this.client.scoreNodeInline(request);
    } catch (error: unknown) {
      // The code is what callers switch on and what persistedError stores, so
      // it stays put. The message did not: discarding the error reported every
      // failure as the service being unreachable, including the ones where it
      // answered and rejected the request. Carry the real reason so the row in
      // node_executions.error says what actually happened.
      const reason = error instanceof Error ? error.message : String(error);
      throw new VerifyGateError(
        "VERIFY_SERVICE_UNAVAILABLE",
        `Verify Service call failed: ${reason}`,
        { cause: error },
      );
    }
  }
}
