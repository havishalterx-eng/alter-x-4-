import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { JsonValue } from "@alterx/shared-clients";
import { ActionCentreService } from "../action-centre/action-centre.service";
import { AdsService } from "../ads/ads.service";
import { IntegrationService } from "../integrations/integration.service";
import type { ActorContext } from "../rbac/types";
import { RunService } from "../runs/run.service";
import { WorkflowService } from "../workflows/workflow.service";
import { DiscoveryHttpError } from "./problem";
import { DiscoveryRepository } from "./discovery.repository";
import type { DiscoveryCandidate, DiscoveryRecommendation, DiscoverySignals } from "./types";

const maximumAggregatePages = 100;
const sourcePageSize = 200;

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly runs: RunService,
    private readonly ads: AdsService,
    private readonly actionCentre: ActionCentreService,
    private readonly integrations: IntegrationService,
    private readonly workflows: WorkflowService,
  ) {}

  async list(actor: ActorContext, traceparent: string | undefined): Promise<DiscoveryRecommendation[]> {
    const workspaceId = requireWorkspaceId(actor, "/api/v1/discovery/recommendations");
    const signals = await this.readSignals(actor, traceparent);
    const candidates = scoreRecommendations(signals);
    await Promise.all(
      candidates.map((candidate) =>
        this.repository.upsertSuggested(actor.tenant_id, workspaceId, newRecommendationId(), candidate),
      ),
    );
    return this.repository.list(actor.tenant_id, workspaceId);
  }

  async accept(
    recommendationId: string,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<DiscoveryRecommendation> {
    const instance = `/api/v1/discovery/recommendations/${encodeURIComponent(recommendationId)}/actions/accept`;
    const workspaceId = requireWorkspaceId(actor, instance);
    const recommendation = await this.requireSuggested(actor.tenant_id, workspaceId, recommendationId, instance);
    const workflow = await this.workflows.create(
      { goal: recommendation.problemStatement },
      actor,
      traceparent,
      idempotencyKey,
    );
    const workflowId = workflow.body.id;
    if (workflow.body.status !== "draft" || typeof workflowId !== "string" || workflowId.length === 0) {
      throw new DiscoveryHttpError(
        502,
        "DISCOVERY_DRAFT_CREATION_FAILED",
        "Workflow creation did not return a draft workflow",
        instance,
      );
    }
    if (!(await this.repository.accept(actor.tenant_id, workspaceId, recommendationId, workflowId))) {
      throw new DiscoveryHttpError(409, "DISCOVERY_RECOMMENDATION_ALREADY_DECIDED", "Recommendation is no longer suggested", instance);
    }
    const accepted = await this.repository.find(actor.tenant_id, workspaceId, recommendationId);
    if (!accepted) {
      throw new DiscoveryHttpError(502, "DISCOVERY_RECOMMENDATION_READ_FAILED", "Accepted recommendation could not be read", instance);
    }
    return accepted;
  }

  async dismiss(recommendationId: string, actor: ActorContext): Promise<void> {
    const instance = `/api/v1/discovery/recommendations/${encodeURIComponent(recommendationId)}/actions/dismiss`;
    const workspaceId = requireWorkspaceId(actor, instance);
    await this.requireSuggested(actor.tenant_id, workspaceId, recommendationId, instance);
    if (!(await this.repository.dismiss(actor.tenant_id, workspaceId, recommendationId))) {
      throw new DiscoveryHttpError(409, "DISCOVERY_RECOMMENDATION_ALREADY_DECIDED", "Recommendation is no longer suggested", instance);
    }
  }

  private async requireSuggested(
    tenantId: string,
    workspaceId: string,
    recommendationId: string,
    instance: string,
  ): Promise<DiscoveryRecommendation> {
    const recommendation = await this.repository.find(tenantId, workspaceId, recommendationId);
    if (!recommendation) {
      throw new DiscoveryHttpError(404, "DISCOVERY_RECOMMENDATION_NOT_FOUND", "Recommendation was not found", instance);
    }
    if (recommendation.status !== "suggested") {
      throw new DiscoveryHttpError(409, "DISCOVERY_RECOMMENDATION_ALREADY_DECIDED", "Recommendation is no longer suggested", instance);
    }
    return recommendation;
  }

  private async readSignals(actor: ActorContext, traceparent: string | undefined): Promise<DiscoverySignals> {
    const workspaceId = requireWorkspaceId(actor, "/api/v1/discovery/recommendations");
    const [runs, adsDocuments, approved, rejected, connectorActivity] = await Promise.all([
      this.readRunHistory(actor, traceparent),
      this.readAdsDocuments(actor, traceparent),
      this.readApprovalHistory("approved", actor, traceparent),
      this.readApprovalHistory("rejected", actor, traceparent),
      this.readConnectorActivity(actor.tenant_id, workspaceId),
    ]);
    return { runs, adsDocuments, decidedApprovals: [...approved, ...rejected], connectorActivity };
  }

  private async readRunHistory(actor: ActorContext, traceparent: string | undefined) {
    const records: Array<DiscoverySignals["runs"][number]> = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < maximumAggregatePages; pageNumber += 1) {
      const page = await this.runs.list({ cursor, limit: sourcePageSize }, actor, traceparent);
      records.push(...page.body.data.map((run) => ({ id: valueString(run, "id"), kind: valueString(run, "status") })));
      if (!page.body.page.has_more) return records.filter(hasId);
      cursor = page.body.page.next_cursor ?? undefined;
      if (!cursor) throw invalidPagination();
    }
    throw invalidPagination();
  }

  private async readAdsDocuments(actor: ActorContext, traceparent: string | undefined) {
    const records: Array<DiscoverySignals["adsDocuments"][number]> = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < maximumAggregatePages; pageNumber += 1) {
      const page = await this.ads.documents({ cursor, limit: sourcePageSize }, actor, traceparent);
      records.push(...page.body.data.map((document) => ({ id: valueString(document, "id"), kind: valueString(document, "source_id") })));
      if (!page.body.page.has_more) return records.filter(hasId);
      cursor = page.body.page.next_cursor ?? undefined;
      if (!cursor) throw invalidPagination();
    }
    throw invalidPagination();
  }

  private async readApprovalHistory(
    status: "approved" | "rejected",
    actor: ActorContext,
    traceparent: string | undefined,
  ) {
    const records: Array<DiscoverySignals["decidedApprovals"][number]> = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < maximumAggregatePages; pageNumber += 1) {
      const page = await this.actionCentre.queue(
        { cursor, limit: sourcePageSize, type: "approval", status },
        actor,
        traceparent,
      );
      records.push(...page.data.map(({ item }) => ({ id: valueString(item, "id"), kind: valueString(item, "status") })));
      if (!page.page.has_more) return records.filter(hasId);
      cursor = page.page.next_cursor ?? undefined;
      if (!cursor) throw invalidPagination();
    }
    throw invalidPagination();
  }

  private async readConnectorActivity(tenantId: string, workspaceId: string) {
    const records: Array<DiscoverySignals["connectorActivity"][number]> = [];
    const connections = await this.integrations.listConnections(tenantId, workspaceId);
    for (const connection of connections) {
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < maximumAggregatePages; pageNumber += 1) {
        const page = await this.integrations.activity(tenantId, workspaceId, connection.id, { cursor, limit: sourcePageSize });
        records.push(...page.data.map((activity) => ({ id: activity.id, kind: activity.action, connector: connection.connector })));
        if (!page.page.has_more) break;
        cursor = page.page.next_cursor ?? undefined;
        if (!cursor) throw invalidPagination();
        if (pageNumber === maximumAggregatePages - 1) throw invalidPagination();
      }
    }
    return records;
  }
}

export function scoreRecommendations(signals: DiscoverySignals): readonly DiscoveryCandidate[] {
  if (
    signals.runs.length === 0 ||
    signals.adsDocuments.length === 0 ||
    signals.decidedApprovals.length < 2 ||
    signals.connectorActivity.length === 0
  ) {
    return [];
  }
  const rejected = signals.decidedApprovals.filter((approval) => approval.kind === "rejected").length;
  const connectors = [...new Set(signals.connectorActivity.map((activity) => activity.connector))].sort();
  const estimatedValue = Math.min(
    100,
    20 + signals.runs.length * 8 + signals.adsDocuments.length * 7 + signals.decidedApprovals.length * 12 + signals.connectorActivity.length * 5,
  );
  const confidence = Number(
    Math.min(0.95, 0.3 + signals.runs.length * 0.03 + signals.adsDocuments.length * 0.04 + signals.decidedApprovals.length * 0.08 + signals.connectorActivity.length * 0.03).toFixed(2),
  );
  return [{
    problemStatement: "Reduce recurring human approval work in connected workflows",
    evidence: evidence(signals),
    estimatedValue,
    estimatedEffort: estimatedValue >= 70 ? 3 : estimatedValue >= 45 ? 2 : 1,
    requiredIntegrations: connectors,
    riskLevel: rejected * 2 >= signals.decidedApprovals.length ? "high" : rejected > 0 ? "medium" : "low",
    confidence,
  }];
}

function evidence(signals: DiscoverySignals): Readonly<Record<string, JsonValue>> {
  return {
    run_ids: signals.runs.map(toEvidenceSignal),
    ads_document_ids: signals.adsDocuments.map(toEvidenceSignal),
    decided_approval_ids: signals.decidedApprovals.map(toEvidenceSignal),
    connector_activity_ids: signals.connectorActivity.map(toEvidenceSignal),
  };
}

function toEvidenceSignal(signal: { readonly id: string; readonly kind?: string; readonly connector?: string }): Record<string, JsonValue> {
  return {
    id: signal.id,
    ...(signal.kind ? { kind: signal.kind } : {}),
    ...(signal.connector ? { connector: signal.connector } : {}),
  };
}

function valueString(record: Readonly<Record<string, JsonValue>>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function hasId(signal: { readonly id: string }): boolean {
  return signal.id.length > 0;
}

function requireWorkspaceId(actor: ActorContext, instance: string): string {
  if (!actor.workspace_id) {
    throw new DiscoveryHttpError(403, "DISCOVERY_WORKSPACE_REQUIRED", "Workspace actor context required", instance);
  }
  return actor.workspace_id;
}

function invalidPagination(): DiscoveryHttpError {
  return new DiscoveryHttpError(
    502,
    "DISCOVERY_SOURCE_PAGINATION_INVALID",
    "A discovery source returned an invalid pagination response",
    "/api/v1/discovery/recommendations",
  );
}

function newRecommendationId(): `rec_${string}` {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `rec_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
