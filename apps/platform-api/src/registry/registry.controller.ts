import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ActorContext, RequireWorkspaceRole, type ActorContextType } from "../rbac";
import { Idempotent } from "../idempotency";
import { RegistryService } from "./registry.service";
import { parseCreateManifest, parseCreateVersion, parseManifestId, parseRevocation, parseVersionId } from "./validation";
const roles = ["admin", "editor", "operator", "approver", "viewer"] as const;
@Controller("/api/v1/registry") export class RegistryController {
  constructor(private readonly registry: RegistryService) {}
  @Get("tools") @RequireWorkspaceRole(...roles) list(@ActorContext() actor: ActorContextType) { return this.registry.list(actor.tenant_id); }
  @Get("tools/:manifestId") @RequireWorkspaceRole(...roles) get(@Param("manifestId") id: string, @ActorContext() actor: ActorContextType) { return this.registry.get(actor.tenant_id, parseManifestId(id, "/api/v1/registry/tools")); }
  @Get("tools/:manifestId/versions") @RequireWorkspaceRole(...roles) versions(@Param("manifestId") id: string, @ActorContext() actor: ActorContextType) { return this.registry.versions(actor.tenant_id, parseManifestId(id, "/api/v1/registry/tools")); }
  @Post("tools") @RequireWorkspaceRole("admin", "editor") create(@Body() body: unknown, @ActorContext() actor: ActorContextType) { return this.registry.create(actor.tenant_id, parseCreateManifest(body, "/api/v1/registry/tools")); }
  @Post("tools/:manifestId/versions") @RequireWorkspaceRole("admin", "editor") createVersion(@Param("manifestId") manifestId: string, @Body() body: unknown, @ActorContext() actor: ActorContextType) { return this.registry.createVersion(actor.tenant_id, parseManifestId(manifestId, "/api/v1/registry/tools"), parseCreateVersion(body, "/api/v1/registry/tools")); }
  @Post("tools/:manifestId/versions/:versionId/actions/scan") @RequireWorkspaceRole("admin", "editor") @Idempotent() scan(@Param("manifestId") manifestId: string, @Param("versionId") versionId: string, @ActorContext() actor: ActorContextType) { return this.registry.scan(actor.tenant_id, parseManifestId(manifestId, "/api/v1/registry/tools"), parseVersionId(versionId, "/api/v1/registry/tools")); }
  @Get("tools/:manifestId/versions/:versionId/scan-report") @RequireWorkspaceRole(...roles) report(@Param("manifestId") manifestId: string, @Param("versionId") versionId: string, @ActorContext() actor: ActorContextType) { return this.registry.report(actor.tenant_id, parseManifestId(manifestId, "/api/v1/registry/tools"), parseVersionId(versionId, "/api/v1/registry/tools")); }
  @Post("tools/:manifestId/versions/:versionId/actions/revoke") @RequireWorkspaceRole("admin") @Idempotent() revoke(@Param("manifestId") manifestId: string, @Param("versionId") versionId: string, @Body() body: unknown, @ActorContext() actor: ActorContextType) { return this.registry.revoke(actor.tenant_id, parseManifestId(manifestId, "/api/v1/registry/tools"), parseVersionId(versionId, "/api/v1/registry/tools"), parseRevocation(body, "/api/v1/registry/tools").reason, actor.user_id); }
}
