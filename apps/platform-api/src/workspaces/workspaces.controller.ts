import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ActorContext, RequireTenantRole } from "../rbac/decorators";
import type { ActorContext as Actor } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import { WorkspacesService, workspaceEtag } from "./workspaces.service";

@Controller("/api/v1/workspaces")
@RequireTenantRole("member")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@ActorContext() actor?: Actor) {
    return this.workspaces.list(requireActor(actor));
  }

  @Post()
  @RequireTenantRole("admin")
  create(@ActorContext() actor: Actor | undefined, @Body() body: { name?: string }) {
    return this.workspaces.create(requireActor(actor), body.name ?? "");
  }

  @Get(":workspaceId")
  async get(
    @ActorContext() actor: Actor | undefined,
    @Param("workspaceId") workspaceId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workspace = await this.workspaces.get(requireActor(actor), workspaceId);
    reply.header("ETag", workspaceEtag(workspace)).send(workspace);
  }

  @Patch(":workspaceId")
  @RequireTenantRole("admin")
  @Header("Cache-Control", "no-store")
  async update(
    @ActorContext() actor: Actor | undefined,
    @Param("workspaceId") workspaceId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: { name?: string },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workspace = await this.workspaces.update(
      requireActor(actor),
      workspaceId,
      body.name ?? "",
      ifMatch,
    );
    reply.header("ETag", workspaceEtag(workspace)).send(workspace);
  }
}

function requireActor(actor: Actor | undefined): Actor {
  if (!actor) {
    throw new PlatformHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
      "/api/v1/workspaces",
    );
  }
  return actor;
}
