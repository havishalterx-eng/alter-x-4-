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
  );
  await startConversationGrpcTransport(app, {
    bindAddress: conversationConfig.grpcBindAddress,
    protoPath: CONVERSATION_PROTO_PATH,
  });
  app.enableShutdownHooks();
  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
