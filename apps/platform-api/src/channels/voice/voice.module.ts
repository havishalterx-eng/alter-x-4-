import { Module } from "@nestjs/common";
import { EngineModule } from "../../engine";
import { IdempotencyModule } from "../../idempotency";
import { VoiceController } from "./voice.controller";
import { VoiceService } from "./voice.service";

@Module({ imports: [EngineModule, IdempotencyModule], controllers: [VoiceController], providers: [VoiceService] })
export class VoiceModule {}
