import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { EngineClient, EngineModule } from "../engine";
import {
  defaultStreamingConfig,
  StreamGateway,
} from "./stream-gateway";
import { StreamController } from "./stream.controller";
import { StreamExceptionFilter } from "./stream-exception.filter";

@Module({
  imports: [EngineModule],
  controllers: [StreamController],
  providers: [
    {
      provide: StreamGateway,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) =>
        new StreamGateway(engine, defaultStreamingConfig),
    },
    {
      provide: APP_FILTER,
      useClass: StreamExceptionFilter,
    },
  ],
  exports: [StreamGateway],
})
export class StreamingModule {}
