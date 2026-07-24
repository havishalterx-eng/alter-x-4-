import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { lastValueFrom, Observable } from "rxjs";
import type { RbacRequest } from "../rbac/types";
import { requestFingerprint } from "./fingerprint";
import { PgIdempotencyStore } from "./idempotency-store";
import { IdempotencyHttpError } from "./problem";

type IdempotencyRequest = FastifyRequest & RbacRequest;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: PgIdempotencyStore) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<IdempotencyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const instance = request.url.split("?")[0] || "/";
    const tenantId = request.actorContext?.tenant_id;
    if (!tenantId) {
      throw new IdempotencyHttpError(
        400,
        "TENANT_CONTEXT_REQUIRED",
        "Authenticated tenant context required",
        instance,
      );
    }

    const key = headerValue(request.headers["idempotency-key"]);
    const fingerprint = requestFingerprint(
      request.method,
      request.url,
      request.body,
    );

    return new Observable((subscriber) => {
      void this.store
        .execute(
          {
            tenantId,
            key: key ?? "",
            fingerprint,
            instance,
          },
          async () => {
            const body = await lastValueFrom(next.handle(), {
              defaultValue: undefined,
            });
            return { status: reply.statusCode, body };
          },
        )
        .then((result) => {
          reply.status(result.status);
          if (result.replayed) {
            reply.header("Idempotency-Replayed", "true");
          }
          subscriber.next(result.body);
          subscriber.complete();
        })
        .catch((error: unknown) => subscriber.error(error));
    });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
