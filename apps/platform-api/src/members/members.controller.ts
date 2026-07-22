import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ActorContext, RequireTenantRole } from "../rbac/decorators";
import type { ActorContext as Actor } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import { MembersService, type InviteMemberInput } from "./members.service";

@Controller("/api/v1/members")
@RequireTenantRole("member")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@ActorContext() actor?: Actor) {
    return this.members.list(requireActor(actor));
  }

  @Post()
  @RequireTenantRole("admin")
  invite(@ActorContext() actor: Actor | undefined, @Body() body: InviteMemberInput) {
    return this.members.invite(requireActor(actor), body);
  }

  @Delete(":memberId")
  @RequireTenantRole("admin")
  async remove(
    @ActorContext() actor: Actor | undefined,
    @Param("memberId") memberId: string,
    @Query("scope") scope = "tenant",
  ): Promise<void> {
    await this.members.remove(requireActor(actor), memberId, scope);
  }
}

function requireActor(actor: Actor | undefined): Actor {
  if (!actor) {
    throw new PlatformHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
      "/api/v1/members",
    );
  }
  return actor;
}
