import {
  applyDecorators,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import { IdempotencyExceptionFilter } from "./idempotency-exception.filter";
import { IdempotencyInterceptor } from "./idempotency.interceptor";

export function Idempotent(): MethodDecorator {
  return applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    UseFilters(IdempotencyExceptionFilter),
  );
}
