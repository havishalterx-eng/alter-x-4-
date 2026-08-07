import { Injectable } from "@nestjs/common";
import type { AbuseSignal, ReviewAbuseSignalRequest } from "@alterx/contracts";
import { AdminAuditService } from "../admin-audit";
import {
  AbuseSignalRepository,
  AbuseSignalSourceUnavailableError,
} from "./abuse-signal.repository";
import { AbuseSignalsHttpError } from "./problem";

@Injectable()
export class AbuseSignalService {
  constructor(
    private readonly signals: AbuseSignalRepository,
    private readonly audit: AdminAuditService,
  ) {}

  list(status?: AbuseSignal["status"]): Promise<AbuseSignal[]> {
    return this.signals.list(status);
  }

  async refresh(staffUserId: string): Promise<{ observed: number; stored: number }> {
    let facts;
    try {
      facts = await this.signals.collectFacts();
    } catch (error) {
      if (!(error instanceof AbuseSignalSourceUnavailableError)) throw error;
      throw new AbuseSignalsHttpError(
        503,
        "ABUSE_SIGNAL_SOURCES_UNAVAILABLE",
        error.message,
        "/api/v1/admin/abuse/signals/actions/refresh",
      );
    }
    const stored = await this.signals.upsertFacts(facts);
    await this.audit.record({
      actorType: "admin",
      actorRef: staffUserId,
      action: "abuse.signals.refresh",
      targetType: "abuse_queue",
      targetRef: "global",
      reasonCode: "staff_refresh",
      scope: "abuse:write",
    });
    return { observed: facts.length, stored };
  }

  async review(
    id: string,
    staffUserId: string,
    input: ReviewAbuseSignalRequest,
  ): Promise<AbuseSignal> {
    const signal = await this.signals.review(id, input.decision, input.reason, staffUserId);
    if (!signal) {
      throw new AbuseSignalsHttpError(
        409,
        "ABUSE_SIGNAL_NOT_OPEN",
        "Abuse signal is missing or already reviewed",
        `/api/v1/admin/abuse/signals/${id}/actions/review`,
      );
    }
    await this.audit.record({
      tenantId: signal.tenant_id,
      actorType: "admin",
      actorRef: staffUserId,
      action: `abuse.signal.${input.decision}`,
      targetType: "abuse_signal",
      targetRef: id,
      reasonCode: "staff_decision",
      scope: "abuse:review",
    });
    return signal;
  }
}
