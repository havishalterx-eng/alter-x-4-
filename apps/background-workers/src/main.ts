import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import {
  CostClient,
  SqsQueueProvider,
  TemporalDurableExecutionProvider,
  startExecutorWorker,
  startPlatformJobsWorker,
} from "@alterx/adapters";
import { AppModule } from "./app.module";
import { loadExecutorWorkerEnvironment } from "./config/environment";
import { loadCostEventConsumerEnvironment } from "./config/cost-event-consumer-environment";
import { loadPlatformJobWorkerEnvironment } from "./config/platform-job-worker-environment";
import {
  loadPlatformJobsEnvironment,
  resolveRuntimeSecret,
} from "./config/platform-jobs-environment";
import { BLACKBOARD_PROTO_PATH } from "./executor/blackboard-proto-path";
import { NODEEXEC_PROTO_PATH } from "./executor/nodeexec-proto-path";
import { COST_PROTO_PATH } from "./cost-events/cost-proto-path";
import { CostEventConsumerService } from "./cost-events/cost-event-consumer.service";
import { CostEventConsumerRunner } from "./cost-events/cost-event-consumer-runner";
import { createPlatformJobHandlers } from "./platform-jobs/handlers";
import { NotificationDigestSchedulerRunner } from "./platform-jobs/notification-digest-scheduler-runner";
import { IntervalJobSchedulerRunner } from "./platform-jobs/interval-job-scheduler-runner";

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

  // Platform Jobs worker (Engagement Phase, doc 12): real `platform`
  // Temporal namespace, independent of the Executor worker's `engine`
  // namespace above -- separate concerns, separate task queues.
  const platformJobsEnvironment = loadPlatformJobWorkerEnvironment(process.env);
  const platformJobsConfig = loadPlatformJobsEnvironment(process.env);
  const notificationDigestServiceToken = await resolveRuntimeSecret(
    platformJobsConfig.notificationDigestServiceTokenRef,
  );
  const connectorHealthSweepServiceToken = await resolveRuntimeSecret(
    platformJobsConfig.connectorHealthSweepServiceTokenRef,
  );
  const retentionSweepServiceToken = await resolveRuntimeSecret(
    platformJobsConfig.retentionSweepServiceTokenRef,
  );
  const evalFacadeServiceToken = await resolveRuntimeSecret(
    platformJobsConfig.evalFacadeServiceTokenRef,
  );
  const platformJobsWorker = await startPlatformJobsWorker(
    {
      temporal: {
        address: platformJobsEnvironment.temporalAddress,
        namespace: platformJobsEnvironment.temporalNamespace,
        taskQueue: platformJobsEnvironment.taskQueue,
        ...(platformJobsEnvironment.temporalApiKey === undefined
          ? {}
          : { apiKey: platformJobsEnvironment.temporalApiKey }),
      },
    },
    createPlatformJobHandlers({
      platformApiInternalBaseUrl: platformJobsConfig.platformApiInternalBaseUrl,
      notificationDigestServiceToken,
      connectorHealthSweepServiceToken,
      adsCoreInternalBaseUrl: platformJobsConfig.adsCoreInternalBaseUrl,
      retentionSweepServiceToken,
      orchestrationServiceInternalBaseUrl: platformJobsConfig.orchestrationServiceInternalBaseUrl,
      evalFacadeServiceToken,
    }),
  );

  // Real periodic trigger for the notification digest job -- durability
  // and retry live in the Temporal workflow itself (platformJobWorkflow),
  // this loop only decides when to start a real execution.
  const digestDurableExecution = new TemporalDurableExecutionProvider({
    address: platformJobsEnvironment.temporalAddress,
    namespace: platformJobsEnvironment.temporalNamespace,
    taskQueue: platformJobsEnvironment.taskQueue,
    ...(platformJobsEnvironment.temporalApiKey === undefined
      ? {}
      : { apiKey: platformJobsEnvironment.temporalApiKey }),
  });
  const digestSchedulerRunner = new NotificationDigestSchedulerRunner(
    digestDurableExecution,
    platformJobsConfig.notificationDigestIntervalMs,
  );
  digestSchedulerRunner.start();

  // Real periodic triggers for the connector health sweep and retention
  // sweep job types -- same durable-workflow-owns-retry reasoning as the
  // digest scheduler above, reusing the same Temporal connection.
  const connectorHealthSweepRunner = new IntervalJobSchedulerRunner(
    digestDurableExecution,
    "platform.connector-health-sweep",
    "connector-health-sweep",
    platformJobsConfig.connectorHealthSweepIntervalMs,
  );
  connectorHealthSweepRunner.start();

  const retentionSweepRunner = new IntervalJobSchedulerRunner(
    digestDurableExecution,
    "platform.retention-sweep",
    "retention-sweep",
    platformJobsConfig.retentionSweepIntervalMs,
  );
  retentionSweepRunner.start();

  const benchmarkSweepRunner = new IntervalJobSchedulerRunner(
    digestDurableExecution,
    "platform.benchmark-sweep",
    "benchmark-sweep",
    platformJobsConfig.benchmarkSweepIntervalMs,
  );
  benchmarkSweepRunner.start();

  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().addHook("onClose", () => {
    worker.shutdown();
    void costEventRunner.stop();
    platformJobsWorker.shutdown();
    void digestSchedulerRunner.stop();
    void connectorHealthSweepRunner.stop();
    void retentionSweepRunner.stop();
    void benchmarkSweepRunner.stop();
  });

  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
