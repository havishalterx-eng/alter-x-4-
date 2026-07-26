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
  RequireTenantRole,
  type ActorContextType,
} from "../rbac";
import { CredentialExceptionFilter } from "./credential-exception.filter";
import { CredentialService } from "./credential.service";
import type { CredentialView } from "./types";
import {
  parseCreateCredential,
  parseCredentialId,
  parseUpdateCredential,
} from "./validation";

@Controller("/api/v1/credentials")
@UseFilters(CredentialExceptionFilter)
export class CredentialController {
  constructor(private readonly credentials: CredentialService) {}

  @Post()
  @HttpCode(201)
  @RequireTenantRole("admin")
  @RequirePermission("credential:write")
  @Idempotent()
  create(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ): Promise<CredentialView> {
    return this.credentials.create(
      actor.tenant_id,
      parseCreateCredential(body, "/api/v1/credentials"),
    );
  }

  @Get()
  @RequireTenantRole("member")
  @RequirePermission("credential:read")
  list(@ActorContext() actor: ActorContextType): Promise<CredentialView[]> {
    return this.credentials.list(actor.tenant_id);
  }

  @Get(":id")
  @RequireTenantRole("member")
  @RequirePermission("credential:read")
  @UseInterceptors(EtagResponseInterceptor)
  get(
    @Param("id") id: string,
    @ActorContext() actor: ActorContextType,
  ): Promise<CredentialView> {
    const instance = `/api/v1/credentials/${id}`;
    return this.credentials.get(
      actor.tenant_id,
      parseCredentialId(id, instance),
      instance,
    );
  }

  @Patch(":id")
  @RequireTenantRole("admin")
  @RequirePermission("credential:write")
  @EtagConstrained()
  @Idempotent()
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ): Promise<CredentialView> {
    const instance = `/api/v1/credentials/${id}`;
    return this.credentials.update(
      actor.tenant_id,
      parseCredentialId(id, instance),
      parseUpdateCredential(body, instance),
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireTenantRole("admin")
  @RequirePermission("credential:delete")
  @Idempotent()
  delete(
    @Param("id") id: string,
    @ActorContext() actor: ActorContextType,
  ): Promise<void> {
    const instance = `/api/v1/credentials/${id}`;
    return this.credentials.delete(
      actor.tenant_id,
      parseCredentialId(id, instance),
    );
  }
}
