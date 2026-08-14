import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import {
  connectBlackboardGrpcTransport,
  connectArtifactContentGrpcTransport,
  connectCompilerGrpcTransport,
  connectDeployctlGrpcTransport,
  connectNodeexecGrpcTransport,
  connectRegistryGrpcTransport,
  connectRecoveryGrpcTransport,
  connectRunsGrpcTransport,
  startConversationGrpcTransport,
} from "@alterx/adapters";
import { AppModule } from "./app.module";
import { loadBlackboardEnvironment } from "./config/blackboard-environment";
import { loadCompilerEnvironment } from "./config/compiler-environment";
import { loadConversationManagerEnvironment } from "./config/environment";
import { loadDeploymentControllerEnvironment } from "./config/deployment-controller-environment";
import { loadNodeexecEnvironment } from "./config/nodeexec-environment";
import { loadRegistryEnvironment } from "./config/registry-environment";
import { loadRecoveryEnvironment } from "./config/recovery-environment";
import { loadRunsEnvironment } from "./config/runs-environment";
import { loadArtifactContentEnvironment } from "./config/artifact-content-environment";
import { BLACKBOARD_PROTO_PATH } from "./blackboard/grpc.constants";
import { COMPILER_PROTO_PATH } from "./compiler/grpc.constants";
import { CONVERSATION_PROTO_PATH } from "./conversation/grpc.constants";
import { DEPLOYCTL_PROTO_PATH } from "./deployment-controller/grpc.constants";
import { NODEEXEC_PROTO_PATH } from "./registry/nodeexec-grpc.constants";
import { REGISTRY_PROTO_PATH } from "./registry/grpc.constants";
import { RECOVERY_PROTO_PATH } from "./recovery/grpc.constants";
import { RUNS_PROTO_PATH } from "./runs/grpc.constants";
import { ARTIFACT_CONTENT_PROTO_PATH } from "./artifacts/grpc.constants";

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

async function bootstrap(): Promise<void> {
  const conversationConfig = loadConversationManagerEnvironment(process.env);
  const compilerConfig = loadCompilerEnvironment(process.env);
  const deploymentConfig = loadDeploymentControllerEnvironment(process.env);
  const registryConfig = loadRegistryEnvironment(process.env);
  const nodeexecConfig = loadNodeexecEnvironment(process.env);
  const recoveryConfig = loadRecoveryEnvironment(process.env);
  const runsConfig = loadRunsEnvironment(process.env);
  const blackboardConfig = loadBlackboardEnvironment(process.env);
  const artifactContentConfig = loadArtifactContentEnvironment(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 25 * 1024 * 1024 }),
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
  // starting every gRPC microservice together. Order matters: connect
  // every transport before the one call that starts them all.
  connectCompilerGrpcTransport(app, {
    bindAddress: compilerConfig.grpcBindAddress,
    protoPath: COMPILER_PROTO_PATH,
  });
  connectDeployctlGrpcTransport(app, {
    bindAddress: deploymentConfig.grpcBindAddress,
    protoPath: DEPLOYCTL_PROTO_PATH,
  });
  connectRegistryGrpcTransport(app, {
    bindAddress: registryConfig.grpcBindAddress,
    protoPath: REGISTRY_PROTO_PATH,
  });
  connectNodeexecGrpcTransport(app, {
    bindAddress: nodeexecConfig.grpcBindAddress,
    protoPath: NODEEXEC_PROTO_PATH,
  });
  connectBlackboardGrpcTransport(app, {
    bindAddress: blackboardConfig.grpcBindAddress,
    protoPath: BLACKBOARD_PROTO_PATH,
  });
  connectRecoveryGrpcTransport(app, {
    bindAddress: recoveryConfig.grpcBindAddress,
    protoPath: RECOVERY_PROTO_PATH,
  });
  connectRunsGrpcTransport(app, {
    bindAddress: runsConfig.grpcBindAddress,
    protoPath: RUNS_PROTO_PATH,
  });
  connectArtifactContentGrpcTransport(app, {
    bindAddress: artifactContentConfig.grpcBindAddress,
    protoPath: ARTIFACT_CONTENT_PROTO_PATH,
  });
  await startConversationGrpcTransport(app, {
    bindAddress: conversationConfig.grpcBindAddress,
    protoPath: CONVERSATION_PROTO_PATH,
  });
  app.enableShutdownHooks();
  await app.listen(parsePort(process.env.PORT), "0.0.0.0");
}

void bootstrap();
