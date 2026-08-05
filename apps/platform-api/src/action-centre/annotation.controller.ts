import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { RequireWorkspaceRole, ActorContext, type ActorContextType } from "../rbac";
import { Idempotent } from "../idempotency";
import { AnnotationRepository, type ActionItemType } from "./annotation.repository";
import { ActionCentreHttpError } from "./problem";

const editorRoles = ["admin", "editor"] as const;

@Controller("/api/v1/action-items")
export class AnnotationController {
  constructor(private readonly annotations: AnnotationRepository) {}

  @Get(":type/:id/annotations") @RequireWorkspaceRole(...editorRoles)
  list(
    @Param("type") type: string,
    @Param("id") id: string,
    @ActorContext() actor: ActorContextType | undefined,
  ) {
    return this.annotations.list(tenant(actor), itemType(type), itemId(id));
  }

  @Post(":type/:id/annotations") @RequireWorkspaceRole(...editorRoles) @Idempotent()
  create(
    @Param("type") type: string,
    @Param("id") id: string,
    @Body() body: { note?: unknown },
    @ActorContext() actor: ActorContextType | undefined,
  ) {
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note || note.length > 4000) {
      throw bad("note must be 1-4000 characters");
    }
    const context = actor ?? (() => { throw bad("Authenticated actor required", 401); })();
    return this.annotations.create(
      tenant(context),
      itemType(type),
      itemId(id),
      note,
      context.user_id,
    );
  }
}

function itemType(value: string): ActionItemType {
  if (value === "approval" || value === "clarification" || value === "escalation") {
    return value;
  }
  throw bad("Invalid action item type");
}

function itemId(value: string): string {
  if (!/^(apr|clr|esc)_[0-9a-f-]+$/i.test(value)) {
    throw bad("Invalid action item ID");
  }
  return value;
}

function tenant(actor: ActorContextType | undefined): string {
  if (!actor?.tenant_id) throw bad("Authenticated tenant required", 401);
  return actor.tenant_id;
}

function bad(detail: string, status: 400 | 401 = 400): ActionCentreHttpError {
  return new ActionCentreHttpError(
    status,
    "INVALID_ACTION_ITEM_ANNOTATION",
    "Action item annotation request validation failed",
    "/api/v1/action-items",
    [{ field: "body", message: detail }],
  );
}
