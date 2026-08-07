import { Injectable } from "@nestjs/common";
import type { AuditActorType } from "@alterx/shared-clients";
import { AuditEventsClient } from "../engine";

export interface AdminAuditInput {
  readonly tenantId?: string;
  readonly actorType: Extract<AuditActorType, "admin" | "support">;
  readonly actorRef: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetRef: string;
  readonly reasonCode?: string;
  readonly scope: string | readonly string[];
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly audit: AuditEventsClient) {}

  async record(input: AdminAuditInput): Promise<string> {
    const result = await this.audit.record({
      tenant_id: input.tenantId ?? "",
      actor_type: input.actorType,
      actor_ref: input.actorRef,
      action: input.action,
      target_type: input.targetType,
      target_ref: input.targetRef,
      result: "success",
      reason_code: input.reasonCode ?? "",
      context_json: JSON.stringify({ scope: input.scope }),
      occurred_at: new Date().toISOString(),
    });
    return result.entry_hash;
  }
}
