import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { EtagResource, EtagResourceResolver } from "../concurrency";
import type { RbacRequest } from "../rbac";
import { EnvVarService } from "./env-var.service";
import { EnvVarHttpError } from "./problem";

@Injectable()
export class EnvVarEtagResolver implements EtagResourceResolver {
  constructor(private readonly envVars: EnvVarService) {}

  async resolve(request: FastifyRequest): Promise<EtagResource> {
    const typed = request as FastifyRequest & RbacRequest;
    const actor = typed.actorContext;
    const projectId = typed.params?.projectId;
    const id = typed.params?.id;
    const instance =
      request.url.split("?")[0] || "/api/v1/projects/unknown/env-vars";
    if (!actor || !projectId || !id) {
      throw new EnvVarHttpError(
        400,
        "INVALID_ENV_VAR_REQUEST",
        "Environment variable, project, and actor context required",
        instance,
      );
    }
    const resource = await this.envVars.get(
      actor.tenant_id,
      projectId,
      id,
      instance,
    );
    return { resource, version: resource.version };
  }
}
