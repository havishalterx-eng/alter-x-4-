import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { EtagResource, EtagResourceResolver } from "../concurrency";
import type { RbacRequest } from "../rbac";
import { TriggerHttpError } from "./problem";
import { TriggerService } from "./trigger.service";

@Injectable()
export class TriggerEtagResolver implements EtagResourceResolver {
  constructor(private readonly triggers: TriggerService) {}

  async resolve(request: FastifyRequest): Promise<EtagResource> {
    const typed = request as FastifyRequest & RbacRequest;
    const actor = typed.actorContext;
    const id = typed.params?.id;
    const instance = request.url.split("?")[0] || "/api/v1/triggers";
    if (!actor || !id) {
      throw new TriggerHttpError(
        400,
        "INVALID_TRIGGER_REQUEST",
        "Trigger and actor context required",
        instance,
      );
    }
    const current = await this.triggers.get(
      id,
      actor,
      headerValue(request.headers.traceparent),
    );
    return { resource: current.body };
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
