import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { EtagResource, EtagResourceResolver } from "../concurrency";
import type { RbacRequest } from "../rbac";
import { CredentialHttpError } from "./problem";
import { CredentialService } from "./credential.service";

@Injectable()
export class CredentialEtagResolver implements EtagResourceResolver {
  constructor(private readonly credentials: CredentialService) {}

  async resolve(request: FastifyRequest): Promise<EtagResource> {
    const typed = request as FastifyRequest & RbacRequest;
    const actor = typed.actorContext;
    const id = typed.params?.id;
    const instance = request.url.split("?")[0] || "/api/v1/credentials";
    if (!actor || !id) {
      throw new CredentialHttpError(
        400,
        "INVALID_CREDENTIAL_REQUEST",
        "Credential and actor context required",
        instance,
      );
    }
    const resource = await this.credentials.get(actor.tenant_id, id, instance);
    return { resource, version: resource.version };
  }
}
