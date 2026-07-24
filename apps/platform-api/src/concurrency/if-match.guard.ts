import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { computeEtag, ifMatchIncludes } from "./etag";
import { ConcurrencyHttpError } from "./problem";

export const ETAG_RESOURCE_RESOLVER = Symbol("ETAG_RESOURCE_RESOLVER");

export interface EtagResource {
  resource: unknown;
  version?: string | number;
}

export interface EtagResourceResolver {
  resolve(request: FastifyRequest): Promise<EtagResource>;
}

@Injectable()
export class IfMatchGuard implements CanActivate {
  constructor(
    @Inject(ETAG_RESOURCE_RESOLVER)
    private readonly resolver: EtagResourceResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const instance = request.url.split("?")[0] || "/";
    const ifMatch = headerValue(request.headers["if-match"]);
    if (!ifMatch) {
      throw new ConcurrencyHttpError(
        428,
        "IF_MATCH_REQUIRED",
        "If-Match header required",
        instance,
      );
    }

    const current = await this.resolver.resolve(request);
    const currentEtag = computeEtag(current.resource, current.version);
    if (!ifMatchIncludes(ifMatch, currentEtag)) {
      reply.header("ETag", currentEtag);
      throw new ConcurrencyHttpError(
        412,
        "ETAG_MISMATCH",
        "Resource changed since it was read",
        instance,
      );
    }
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
