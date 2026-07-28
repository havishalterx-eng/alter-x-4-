import type {
  BlackboardReadValueRequest,
  BlackboardReadValueResponse,
  BlackboardWriteValueRequest,
  BlackboardWriteValueResponse,
} from "@alterx/contracts";
import type { JsonValue } from "@alterx/shared-clients";

import { BlackboardService, BlackboardValidationError } from "./blackboard.service";

function parseValueJson(json: string): JsonValue {
  try {
    return JSON.parse(json) as JsonValue;
  } catch (error: unknown) {
    throw new BlackboardValidationError(
      `value_json is not valid JSON: ${(error as Error).message}`,
    );
  }
}

/**
 * gRPC-facing facade over BlackboardService (EXEC-5) -- no new business
 * logic, just wire-format <-> domain-call translation. This is what makes
 * the Blackboard finally reachable from the Executor's activities
 * (EXEC-7), closing EXEC-5's disclosed "not wired into a live Executor"
 * gap the same way EXEC-6 closed it for the Node Type Registry handlers.
 */
export class BlackboardGrpcService {
  constructor(private readonly blackboard: BlackboardService) {}

  async writeValue(
    request: BlackboardWriteValueRequest,
  ): Promise<BlackboardWriteValueResponse> {
    await this.blackboard.writeValue({
      tenantId: request.tenant_id,
      runId: request.run_id,
      key: request.key,
      value: parseValueJson(request.value_json),
    });
    return {};
  }

  async readValue(
    request: BlackboardReadValueRequest,
  ): Promise<BlackboardReadValueResponse> {
    const value = await this.blackboard.readValue({
      tenantId: request.tenant_id,
      runId: request.run_id,
      key: request.key,
    });
    if (value === undefined) {
      return { found: false, value_json: "" };
    }
    return { found: true, value_json: JSON.stringify(value) };
  }
}
