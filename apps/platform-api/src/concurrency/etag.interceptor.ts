import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { map, type Observable } from "rxjs";
import { computeEtag } from "./etag";

@Injectable()
export class EtagResponseInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((body: unknown) => {
        reply.header("ETag", computeEtag(body, resourceVersion(body)));
        return body;
      }),
    );
  }
}

function resourceVersion(body: unknown): string | number | undefined {
  if (body === null || typeof body !== "object") {
    return undefined;
  }
  const version = Reflect.get(body, "version") ?? Reflect.get(body, "revision");
  return typeof version === "string" || typeof version === "number"
    ? version
    : undefined;
}
