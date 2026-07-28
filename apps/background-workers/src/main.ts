import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { startExecutorWorker } from "@alterx/adapters";
import { AppModule } from "./app.module";
import { loadExecutorWorkerEnvironment } from "./config/environment";
import { BLACKBOARD_PROTO_PATH } from "./executor/blackboard-proto-path";
import { NODEEXEC_PROTO_PATH } from "./executor/nodeexec-proto-path";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // The health check (HTTP) and the Executor's Temporal worker are
  // independent concerns running in the same process -- the worker owns
  // no HTTP surface of its own. All vendor SDK usage (Temporal, gRPC) is
  // hidden inside startExecutorWorker (packages/adapters) -- adapter law.
  const environment = loadExecutorWorkerEnvironment(process.env);
  const worker = await startExecutorWorker({
    temporal: {
      address: environment.temporalAddress,
      namespace: environment.temporalNamespace,
      taskQueue: environment.taskQueue,
      ...(environment.temporalApiKey === undefined
        ? {}
        : { apiKey: environment.temporalApiKey }),
    },
    nodeexec: {
      address: environment.nodeexecAddress,
      protoPath: NODEEXEC_PROTO_PATH,
    },
    blackboard: {
      address: environment.blackboardAddress,
      protoPath: BLACKBOARD_PROTO_PATH,
    },
  });

  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().addHook("onClose", () => {
    worker.shutdown();
  });

  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
