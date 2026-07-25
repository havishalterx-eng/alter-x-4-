import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { startConversationGrpcTransport } from "@alterx/adapters";
import { AppModule } from "./app.module";
import { loadConversationManagerEnvironment } from "./config/environment";
import { CONVERSATION_PROTO_PATH } from "./conversation/grpc.constants";

async function bootstrap(): Promise<void> {
  const conversationConfig = loadConversationManagerEnvironment(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    // rawBody: true makes Fastify retain the exact pre-parse body bytes on
    // request.rawBody for every route -- Nest/Fastify have no native
    // per-route scoping for this. Only the WhatsApp webhook route reads
    // request.rawBody (required for HMAC-SHA256 signature verification);
    // every other route's behavior is unaffected.
    { rawBody: true },
  );
  await startConversationGrpcTransport(app, {
    bindAddress: conversationConfig.grpcBindAddress,
    protoPath: CONVERSATION_PROTO_PATH,
  });
  app.enableShutdownHooks();
  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
