import { Module } from "@nestjs/common";
import { EngineModule } from "../../engine";
import { IdentityBrokerModule } from "../../identity-broker";
import { IdempotencyModule } from "../../idempotency";
import { WhatsappController } from "./whatsapp.controller";
import { WhatsappService } from "./whatsapp.service";

@Module({ imports: [EngineModule, IdentityBrokerModule, IdempotencyModule], controllers: [WhatsappController], providers: [WhatsappService] })
export class WhatsappModule {}
