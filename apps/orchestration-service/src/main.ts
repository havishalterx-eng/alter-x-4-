import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { connectCompilerGrpcTransport, startConversationGrpcTransport } from "@alterx/adapters";
import { AppModule } from "./app.module";
import { loadCompilerEnvironment } from "./config/compiler-environment";
import { loadConversationManagerEnvironment } from "./config/environment";
import { COMPILER_PROTO_PATH } from "./compiler/grpc.constants";
import { CONVERSATION_PROTO_PATH } from "./conversation/grpc.constants";

async function bootstrap(): Promise<void> {
  const conversationConfig = loadConversationManagerEnvironment(process.env);
  const compilerConfig = loadCompilerEnvironment(process.env);

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
  // Compiler's transport only connects here; it does not call
  // startAllMicroservices() itself (see connectCompilerGrpcTransport's
  // doc comment) -- startConversationGrpcTransport below does that once,
  // starting both gRPC microservices together. Order matters: connect
  // every transport before the one call that starts them all.
  connectCompilerGrpcTransport(app, {
    bindAddress: compilerConfig.grpcBindAddress,
    protoPath: COMPILER_PROTO_PATH,
  });
  await startConversationGrpcTransport(app, {
    bindAddress: conversationConfig.grpcBindAddress,
    protoPath: CONVERSATION_PROTO_PATH,
  });
  app.enableShutdownHooks();
  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
