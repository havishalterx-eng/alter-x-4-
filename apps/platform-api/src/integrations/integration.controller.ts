import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import { Idempotent } from "../idempotency";
import {
  ActorContext,
  RequirePermission,
  RequireWorkspaceRole,
} from "../rbac";
import type { ActorContextType } from "../rbac";
import { IntegrationExceptionFilter } from "./integration-exception.filter";
import { IntegrationService } from "./integration.service";
import { IntegrationHttpError } from "./problem";
import type {
  ConnectorCatalogEntry,
  OAuthAuthorizeView,
  OAuthConnectionActivityPage,
  OAuthConnectionView,
  OAuthRevokeView,
  OAuthScopesView,
} from "./types";
import {
  parseConnectionId,
  parseConnectorId,
  parseActivityQuery,
  parseOAuthAuthorizeInput,
  parseOAuthCallbackInput,
} from "./validation";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;
const privilegedRoles = ["admin", "editor"] as const;

@Controller("/api/v1/integrations")
@UseFilters(IntegrationExceptionFilter)
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  @Get()
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("integrations:read")
  catalog(): ConnectorCatalogEntry[] {
    return this.integrations.catalog();
  }

  @Get("connections")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("integrations:read")
  listConnections(
    @ActorContext() actor: ActorContextType | undefined,
  ): Promise<OAuthConnectionView[]> {
    const context = requireWorkspaceActor(actor, "/api/v1/integrations/connections");
    return this.integrations.listConnections(context.tenant_id, context.workspace_id);
  }

  @Get("connections/:connectionId")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("integrations:read")
  getConnection(
    @Param("connectionId") connectionId: string,
    @ActorContext() actor: ActorContextType | undefined,
  ): Promise<OAuthConnectionView> {
    const instance = `/api/v1/integrations/connections/${connectionId}`;
    const context = requireWorkspaceActor(actor, instance);
    const id = parseConnectionId(connectionId, instance);
    return this.integrations.getConnection(context.tenant_id, context.workspace_id, id);
  }

  @Get("connections/:connectionId/activity")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("integrations:read")
  activity(
    @Param("connectionId") connectionId: string,
    @Query() query: unknown,
    @ActorContext() actor: ActorContextType | undefined,
  ): Promise<OAuthConnectionActivityPage> {
    const instance = `/api/v1/integrations/connections/${connectionId}/activity`;
    const context = requireWorkspaceActor(actor, instance);
    const id = parseConnectionId(connectionId, instance);
    return this.integrations.activity(
      context.tenant_id,
      context.workspace_id,
      id,
      parseActivityQuery(query, instance),
    );
  }

  @Get("connections/:connectionId/scopes")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("integrations:read")
  scopes(
    @Param("connectionId") connectionId: string,
    @ActorContext() actor: ActorContextType | undefined,
  ): Promise<OAuthScopesView> {
    const instance = `/api/v1/integrations/connections/${connectionId}/scopes`;
    const context = requireWorkspaceActor(actor, instance);
    const id = parseConnectionId(connectionId, instance);
    return this.integrations.scopes(context.tenant_id, context.workspace_id, id);
  }

  @Post(":connector/actions/authorize")
  @HttpCode(200)
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("integrations:write")
  @Idempotent()
  authorize(
    @Param("connector") connector: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
  ): Promise<OAuthAuthorizeView> {
    const instance = `/api/v1/integrations/${connector}/actions/authorize`;
    const context = requireWorkspaceActor(actor, instance);
    const connectorId = parseConnectorId(connector, instance);
    return this.integrations.authorize(
      context.tenant_id,
      context.workspace_id,
      context.user_id,
      connectorId,
      parseOAuthAuthorizeInput(body, instance),
    );
  }

  @Post(":connector/actions/callback")
  @HttpCode(200)
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("integrations:write")
  @Idempotent()
  callback(
    @Param("connector") connector: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
  ): Promise<OAuthConnectionView> {
    const instance = `/api/v1/integrations/${connector}/actions/callback`;
    const context = requireWorkspaceActor(actor, instance);
    const connectorId = parseConnectorId(connector, instance);
    return this.integrations.callback(
      context.tenant_id,
      context.workspace_id,
      context.user_id,
      connectorId,
      parseOAuthCallbackInput(body, instance),
    );
  }

  @Post("connections/:connectionId/actions/health")
  @HttpCode(200)
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("integrations:write")
  @Idempotent()
  health(
    @Param("connectionId") connectionId: string,
    @ActorContext() actor: ActorContextType | undefined,
  ): Promise<OAuthConnectionView> {
    const instance = `/api/v1/integrations/connections/${connectionId}/actions/health`;
    const context = requireWorkspaceActor(actor, instance);
    const id = parseConnectionId(connectionId, instance);
    return this.integrations.health(
      context.tenant_id,
      context.workspace_id,
      id,
      context.user_id,
    );
  }

  @Post("connections/:connectionId/actions/revoke")
  @HttpCode(200)
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("integrations:write")
  @Idempotent()
  revoke(
    @Param("connectionId") connectionId: string,
    @ActorContext() actor: ActorContextType | undefined,
  ): Promise<OAuthRevokeView> {
    const instance = `/api/v1/integrations/connections/${connectionId}/actions/revoke`;
    const context = requireWorkspaceActor(actor, instance);
    const id = parseConnectionId(connectionId, instance);
    return this.integrations.revoke(
      context.tenant_id,
      context.workspace_id,
      id,
      context.user_id,
    );
  }
}

function requireWorkspaceActor(
  actor: ActorContextType | undefined,
  instance: string,
): ActorContextType & { workspace_id: string } {
  if (!actor) {
    throw new IntegrationHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
      instance,
    );
  }
  if (!actor.workspace_id) {
    throw new IntegrationHttpError(
      403,
      "INTEGRATION_WORKSPACE_REQUIRED",
      "Workspace actor context required",
      instance,
    );
  }
  return actor as ActorContextType & { workspace_id: string };
}
