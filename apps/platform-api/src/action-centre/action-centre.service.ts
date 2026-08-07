import { randomBytes } from "node:crypto";
import type { JsonValue } from "@alterx/shared-clients";
import { Injectable } from "@nestjs/common";
import {
  EngineClient,
  type EngineCallerContext,
  type EngineRequestBody,
  type EngineResponse,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import {
  advanceBatch,
  advanceWithinBatch,
  decodeCursor,
  encodeCursor,
  initialCursor,
} from "./cursor";
import { ActionCentreHttpError } from "./problem";
import {
  type ActionQueueItem,
  type ActionQueuePage,
  type ApprovalStatus,
  type EnginePage,
  type EngineResource,
} from "./types";
import {
  parseActionBody,
  parseClarificationId,
  parseQueueQuery,
  parseResourceId,
  parseTraceparent,
} from "./validation";

type ActionKind = "approve" | "reject";
type EscalationAction = "claim" | "resolve";

@Injectable()
export class ActionCentreService {
  constructor(private readonly engine: EngineClient) {}

  async queue(
    input: unknown,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<ActionQueuePage> {
    const instance = "/api/v1/action-centre";
    const query = parseQueueQuery(input, instance);
    const cursor = query.cursor
      ? decodeCursor(query.cursor, query, instance)
      : initialCursor(query);
    const context = callerContext(actor, traceparent, instance);
    const includeApprovals =
      cursor.type !== "clarification" && cursor.type !== "escalation";
    const includeClarifications =
      cursor.type !== "approval" && cursor.type !== "escalation";
    const includeEscalations =
      cursor.type !== "approval" &&
      cursor.type !== "clarification" &&
      cursor.status === null;

    const [approvals, clarifications, escalations] = await Promise.all([
      includeApprovals && !cursor.approval_done
        ? this.engine.get<EnginePage<EngineResource>>(
            listPath(
              "/api/v1/approvals",
              cursor.approval_cursor,
              cursor.limit,
              cursor.status,
            ),
            context,
          )
        : undefined,
      includeClarifications && !cursor.clarification_done
        ? this.engine.get<EnginePage<EngineResource>>(
            listPath(
              "/api/v1/clarifications",
              cursor.clarification_cursor,
              cursor.limit,
            ),
            context,
          )
        : undefined,
      includeEscalations && !cursor.escalation_done
        ? this.engine.get<EnginePage<EngineResource>>(
            listPath(
              "/api/v1/escalations",
              cursor.escalation_cursor,
              cursor.limit,
            ),
            context,
          )
        : undefined,
    ]);
    assertPage(approvals?.body.page, instance);
    assertPage(clarifications?.body.page, instance);
    assertPage(escalations?.body.page, instance);

    const merged = interleave([
      tag("approval", approvals?.body.data ?? []),
      tag("clarification", clarifications?.body.data ?? []),
      tag("escalation", escalations?.body.data ?? []),
    ]);
    const data = merged.slice(cursor.offset, cursor.offset + cursor.limit);
    const next = nextCursor(
      cursor,
      merged.length,
      approvals?.body.page,
      clarifications?.body.page,
      escalations?.body.page,
      includeApprovals,
      includeClarifications,
      includeEscalations,
    );

    return {
      data,
      page: {
        next_cursor: next,
        has_more: next !== null,
        limit: cursor.limit,
      },
    };
  }

  decideApproval(
    approvalId: string,
    action: ActionKind,
    body: unknown,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<EngineResource>> {
    const instance = `/api/v1/approvals/${approvalId}/actions/${action}`;
    const id = parseResourceId(approvalId, "approvalId", instance);
    return this.engine.post(
      `/api/v1/approvals/${encodeURIComponent(id)}/actions/${action}`,
      jsonBody(parseActionBody(body, instance)),
      callerContext(actor, traceparent, instance),
      { idempotencyKey },
    );
  }

  actOnEscalation(
    escalationId: string,
    action: EscalationAction,
    body: unknown,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<EngineResource>> {
    const instance = `/api/v1/escalations/${escalationId}/actions/${action}`;
    const id = parseResourceId(escalationId, "escalationId", instance);
    return this.engine.post(
      `/api/v1/escalations/${encodeURIComponent(id)}/actions/${action}`,
      jsonBody(parseActionBody(body, instance)),
      callerContext(actor, traceparent, instance),
      { idempotencyKey },
    );
  }

  answerClarification(
    runId: string,
    clarificationId: string,
    body: unknown,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<EngineResource>> {
    const instance =
      `/api/v1/runs/${runId}/clarifications/${clarificationId}/answer`;
    const run = parseResourceId(runId, "runId", instance);
    const clarification = parseClarificationId(clarificationId, instance);
    return this.engine.post(
      `/api/v1/runs/${encodeURIComponent(run)}/clarifications/${encodeURIComponent(clarification)}/answer`,
      jsonBody(parseActionBody(body, instance)),
      callerContext(actor, traceparent, instance),
      { idempotencyKey },
    );
  }

  assignClarification(
    clarificationId: string,
    body: unknown,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<EngineResource>> {
    const instance = `/api/v1/clarifications/${clarificationId}/actions/assign`;
    const id = parseClarificationId(clarificationId, instance);
    return this.engine.post(
      `/api/v1/clarifications/${encodeURIComponent(id)}/actions/assign`,
      jsonBody(body),
      callerContext(actor, traceparent, instance),
      { idempotencyKey },
    );
  }
}

function nextCursor(
  cursor: ReturnType<typeof initialCursor>,
  mergedLength: number,
  approvalPage: EnginePage<EngineResource>["page"] | undefined,
  clarificationPage: EnginePage<EngineResource>["page"] | undefined,
  escalationPage: EnginePage<EngineResource>["page"] | undefined,
  includeApprovals: boolean,
  includeClarifications: boolean,
  includeEscalations: boolean,
): string | null {
  const nextOffset = cursor.offset + cursor.limit;
  if (nextOffset < mergedLength) {
    return encodeCursor(advanceWithinBatch(cursor, nextOffset));
  }
  const advanced = advanceBatch(
    cursor,
    approvalPage,
    clarificationPage,
    escalationPage,
  );
  const approvalsDone = !includeApprovals || advanced.approval_done;
  const clarificationsDone =
    !includeClarifications || advanced.clarification_done;
  const escalationsDone = !includeEscalations || advanced.escalation_done;
  return approvalsDone && clarificationsDone && escalationsDone
    ? null
    : encodeCursor(advanced);
}

function assertPage(
  page: EnginePage<EngineResource>["page"] | undefined,
  instance: string,
): void {
  if (page?.has_more && !page.next_cursor) {
    throw new ActionCentreHttpError(
      502,
      "INVALID_ENGINE_ACTION_QUEUE_RESPONSE",
      "Engine returned an invalid action queue page",
      instance,
    );
  }
}

function listPath(
  base:
    | "/api/v1/approvals"
    | "/api/v1/clarifications"
    | "/api/v1/escalations",
  cursor: string | null,
  limit: number,
  status?: ApprovalStatus | null,
): `${typeof base}${string}` {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  if (status) query.set("status", status);
  return `${base}?${query.toString()}`;
}

function tag(
  sourceType: ActionQueueItem["source_type"],
  items: readonly EngineResource[],
): ActionQueueItem[] {
  return items.map((item) => ({ source_type: sourceType, item }));
}

function interleave(
  sources: readonly (readonly ActionQueueItem[])[],
): ActionQueueItem[] {
  const result: ActionQueueItem[] = [];
  const length = Math.max(0, ...sources.map((source) => source.length));
  for (let index = 0; index < length; index += 1) {
    for (const source of sources) {
      const item = source[index];
      if (item) result.push(item);
    }
  }
  return result;
}

function callerContext(
  actor: ActorContext,
  traceparent: string | undefined,
  instance: string,
): EngineCallerContext {
  if (!actor.workspace_id) {
    throw new ActionCentreHttpError(
      403,
      "ACTION_CENTRE_WORKSPACE_REQUIRED",
      "Workspace context required",
      instance,
    );
  }
  return {
    userId: actor.user_id,
    tenantId: actor.tenant_id,
    workspaceId: actor.workspace_id,
    sessionId: actor.session_id,
    authTime: actor.auth_time ?? Math.floor(Date.now() / 1000),
    roles: actor.roles,
    permissions: actor.permissions,
    traceparent: parseTraceparent(traceparent, instance) ?? newTraceparent(),
  };
}

function jsonBody(value: unknown): EngineRequestBody {
  return value as JsonValue;
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}
