import {
  type DynamicModule,
  Module,
  type Type,
} from "@nestjs/common";
import { EtagResponseInterceptor } from "./etag.interceptor";
import { ConcurrencyExceptionFilter } from "./concurrency-exception.filter";
import {
  ETAG_RESOURCE_RESOLVER,
  IfMatchGuard,
} from "./if-match.guard";

@Module({})
export class ConcurrencyModule {
  static forFeature(
    resolver: Type<import("./if-match.guard").EtagResourceResolver>,
  ): DynamicModule {
    return {
      module: ConcurrencyModule,
      providers: [
        {
          provide: ETAG_RESOURCE_RESOLVER,
          useClass: resolver,
        },
        IfMatchGuard,
        EtagResponseInterceptor,
        ConcurrencyExceptionFilter,
      ],
      exports: [
        IfMatchGuard,
        EtagResponseInterceptor,
        ConcurrencyExceptionFilter,
      ],
    };
  }
}
