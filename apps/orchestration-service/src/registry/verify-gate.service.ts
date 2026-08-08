import type {
  ScoreNodeInlineRequest,
  ScoreNodeInlineResponse,
} from "@alterx/contracts";
import type { VerifyServiceHandlerClient } from "@alterx/adapters";

export class VerifyGateError extends Error {
  constructor(
    readonly code: "VERIFICATION_GATE_FAILED" | "VERIFY_SERVICE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

export class VerifyGateService {
  constructor(private readonly client: VerifyServiceHandlerClient) {}

  async scoreNodeInline(
    request: ScoreNodeInlineRequest,
  ): Promise<ScoreNodeInlineResponse> {
    try {
      return await this.client.scoreNodeInline(request);
    } catch {
      throw new VerifyGateError(
        "VERIFY_SERVICE_UNAVAILABLE",
        "Verify Service is unavailable",
      );
    }
  }
}
