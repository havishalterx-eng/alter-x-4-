import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { EtagResource, EtagResourceResolver } from "../concurrency";
import type { RbacRequest } from "../rbac";
import { WorkflowHttpError } from "./problem";
import { WorkflowService } from "./workflow.service";

type WorkflowRequest = FastifyRequest & RbacRequest;

@Injectable()
export class WorkflowEtagResolver implements EtagResourceResolver {
  constructor(private readonly workflows: WorkflowService) {}

  async resolve(request: FastifyRequest): Promise<EtagResource> {
    const workflowRequest = request as WorkflowRequest;
    const actor = workflowRequest.actorContext;
    const workflowId = workflowRequest.params?.workflowId;
    const instance = request.url.split("?")[0] || "/api/v1/workflows";
    if (!actor || !workflowId) {
      throw new WorkflowHttpError(
        400,
        "INVALID_WORKFLOW_REQUEST",
        "Workflow and actor context required",
        instance,
      );
    }
    const traceparent = headerValue(request.headers.traceparent);
    const current = await this.workflows.get(workflowId, actor, traceparent);
    const version = resourceVersion(current.body);
    return {
      resource: current.body,
      ...(version === undefined ? {} : { version }),
    };
  }
}

function resourceVersion(
  body: Readonly<Record<string, unknown>>,
): string | number | undefined {
  const version = body.revision ?? body.version;
  return typeof version === "string" || typeof version === "number"
    ? version
    : undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
