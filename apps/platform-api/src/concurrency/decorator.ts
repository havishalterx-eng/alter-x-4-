import {
  applyDecorators,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { EtagResponseInterceptor } from "./etag.interceptor";
import { IfMatchGuard } from "./if-match.guard";
import { ConcurrencyExceptionFilter } from "./concurrency-exception.filter";

export function EtagConstrained(): MethodDecorator {
  return applyDecorators(
    UseGuards(IfMatchGuard),
    UseInterceptors(EtagResponseInterceptor),
    UseFilters(ConcurrencyExceptionFilter),
  );
}
