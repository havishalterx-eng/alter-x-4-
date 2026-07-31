import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { CostClient, SqsQueueProvider, startExecutorWorker } from "@alterx/adapters";
import { AppModule } from "./app.module";
import { loadExecutorWorkerEnvironment } from "./config/environment";
import { loadCostEventConsumerEnvironment } from "./config/cost-event-consumer-environment";
import { BLACKBOARD_PROTO_PATH } from "./executor/blackboard-proto-path";
import { NODEEXEC_PROTO_PATH } from "./executor/nodeexec-proto-path";
import { COST_PROTO_PATH } from "./cost-events/cost-proto-path";
import { CostEventConsumerService } from "./cost-events/cost-event-consumer.service";
import { CostEventConsumerRunner } from "./cost-events/cost-event-consumer-runner";

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

  // Cost-events consumer (OUT-4): an independent background loop in this
  // same process, same reasoning as the Executor worker above -- it owns
  // no HTTP surface of its own.
  const costEventsConfig = loadCostEventConsumerEnvironment(process.env);
  const costEventsQueueName = `alter-${costEventsConfig.alterEnvironment}-cost-events`;
  const costEventConsumer = new CostEventConsumerService(
    new SqsQueueProvider({ region: costEventsConfig.region }),
    costEventsQueueName,
    new CostClient({
      address: costEventsConfig.costLedgerServiceAddress,
      protoPath: COST_PROTO_PATH,
    }),
  );
  const costEventRunner = new CostEventConsumerRunner(
    costEventConsumer,
    costEventsConfig.pollIntervalMs,
  );
  costEventRunner.start();

  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().addHook("onClose", () => {
    worker.shutdown();
    void costEventRunner.stop();
  });

  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
