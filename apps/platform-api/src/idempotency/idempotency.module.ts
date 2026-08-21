import { Module } from "@nestjs/common";
import { sharedPool } from "../db/shared-pool";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { PgIdempotencyStore } from "./idempotency-store";
import { IdempotencyExceptionFilter } from "./idempotency-exception.filter";

const defaultTtlSeconds = 86_400;

@Module({
  providers: [
    {
      provide: PgIdempotencyStore,
      useFactory: () => {
        const ttlSeconds = Number(
          process.env.IDEMPOTENCY_TTL_SECONDS ?? defaultTtlSeconds,
        );
        if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
          throw new Error(
            "IDEMPOTENCY_TTL_SECONDS must be a positive integer",
          );
        }
        return new PgIdempotencyStore(
          sharedPool(process.env.DATABASE_URL),
          ttlSeconds * 1_000,
          () => new Date(),
          false,
        );
      },
    },
    IdempotencyInterceptor,
    IdempotencyExceptionFilter,
  ],
  exports: [
    PgIdempotencyStore,
    IdempotencyInterceptor,
    IdempotencyExceptionFilter,
  ],
})
export class IdempotencyModule {}
