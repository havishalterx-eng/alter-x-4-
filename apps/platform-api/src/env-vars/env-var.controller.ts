import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import { EtagConstrained, EtagResponseInterceptor } from "../concurrency";
import { Idempotent } from "../idempotency";
import {
  ActorContext,
  RequirePermission,
  RequireWorkspaceRole,
  type ActorContextType,
} from "../rbac";
import { EnvVarExceptionFilter } from "./env-var-exception.filter";
import { EnvVarService } from "./env-var.service";
import type { EnvVarView } from "./types";
import {
  parseCreateEnvVar,
  parseEnvVarId,
  parseEnvVarProjectId,
  parseUpdateEnvVar,
} from "./validation";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;

@Controller("/api/v1/projects/:projectId/env-vars")
@UseFilters(EnvVarExceptionFilter)
export class EnvVarController {
  constructor(private readonly envVars: EnvVarService) {}

  @Post()
  @HttpCode(201)
  @RequireWorkspaceRole("admin")
  @RequirePermission("projects:write")
  @Idempotent()
  create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ): Promise<EnvVarView> {
    const instance = `/api/v1/projects/${projectId}/env-vars`;
    return this.envVars.create(
      actor.tenant_id,
      parseEnvVarProjectId(projectId, instance),
      parseCreateEnvVar(body, instance),
    );
  }

  @Get()
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  list(
    @Param("projectId") projectId: string,
    @ActorContext() actor: ActorContextType,
  ): Promise<EnvVarView[]> {
    const instance = `/api/v1/projects/${projectId}/env-vars`;
    return this.envVars.list(
      actor.tenant_id,
      parseEnvVarProjectId(projectId, instance),
    );
  }

  @Get(":id")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  @UseInterceptors(EtagResponseInterceptor)
  get(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @ActorContext() actor: ActorContextType,
  ): Promise<EnvVarView> {
    const instance = `/api/v1/projects/${projectId}/env-vars/${id}`;
    return this.envVars.get(
      actor.tenant_id,
      parseEnvVarProjectId(projectId, instance),
      parseEnvVarId(id, instance),
      instance,
    );
  }

  @Patch(":id")
  @RequireWorkspaceRole("admin")
  @RequirePermission("projects:write")
  @EtagConstrained()
  @Idempotent()
  update(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ): Promise<EnvVarView> {
    const instance = `/api/v1/projects/${projectId}/env-vars/${id}`;
    return this.envVars.update(
      actor.tenant_id,
      parseEnvVarProjectId(projectId, instance),
      parseEnvVarId(id, instance),
      parseUpdateEnvVar(body, instance),
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireWorkspaceRole("admin")
  @RequirePermission("projects:write")
  @Idempotent()
  delete(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @ActorContext() actor: ActorContextType,
  ): Promise<void> {
    const instance = `/api/v1/projects/${projectId}/env-vars/${id}`;
    return this.envVars.delete(
      actor.tenant_id,
      parseEnvVarProjectId(projectId, instance),
      parseEnvVarId(id, instance),
    );
  }
}
