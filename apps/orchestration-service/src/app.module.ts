import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import {
  BLACKBOARD_HANDLER,
  COMPILER_HANDLER,
  CONVERSATION_HANDLER,
  DEPLOYCTL_HANDLER,
  NODEEXEC_HANDLER,
  RECOVERY_HANDLER,
  REGISTRY_HANDLER,
  RUNS_HANDLER,
  BlackboardGrpcController,
  ARTIFACT_CONTENT_HANDLER,
  ArtifactContentGrpcController,
  CompilerGrpcController,
  ConversationDispatchClient,
  ConversationGrpcController,
  DeployctlGrpcController,
  ModelGatewayClient,
  PlannerClient,
  PolicyStoreClient,
  SandboxServiceClient,
  AwsSsmParameterProvider,
  S3ObjectStorageProvider,
  NodeexecGrpcController,
  PostgresOrchestrationStoreProvider,
  RedisCacheProvider,
  RecoveryGrpcController,
  RegistryGrpcController,
  RunsGrpcController,
  TemporalDurableExecutionProvider,
  ToolGatewayClient,
} from "@alterx/adapters";
import { createMockQueueProvider } from "@alterx/shared-clients";
import {
  ActorTokenValidator,
  M2mValidator,
  RedisReplayStore,
  RedisRespSetClient,
  SessionGatewayGuard,
} from "@alterx/auth";
import { MODELGW_CLIENT_PROTO_PATH } from "./conversation/grpc.constants";
import { ConversationManagerService } from "./conversation/conversation-manager.service";
import { GraphCompilerService } from "./compiler/graph-compiler.service";
import { DeploymentControllerService } from "./deployment-controller/deployment-controller.service";
import { RegistryService } from "./registry/registry.service";
import { NodeexecService } from "./registry/nodeexec.service";
import { NodeExecutionsController } from "./runs/node-executions.controller";
import { NodeExecutionLedgerService } from "./runs/node-execution-ledger.service";
import { RunStreamEventService } from "./runs/run-stream-event.service";
import { RunStreamController } from "./runs/run-stream.controller";
import { RunLauncherService } from "./runs/run-launcher.service";
import { RunsController } from "./runs/runs.controller";
import { RunOutcomeService } from "./runs/run-outcome.service";
import { RunWorkspaceLookupService } from "./runs/run-workspace-lookup.service";
import { RunLearningController } from "./runs/run-learning.controller";
import { loadRunLauncherEnvironment } from "./config/run-launcher-environment";
import { ApprovalsController } from "./approvals/approvals.controller";
import { ApprovalsService } from "./approvals/approvals.service";
import { createRuntimeNodeHandlerRegistry } from "./registry/node-handler-registry";
import { PostgresVerificationGateReader } from "./registry/verification-gate-reader";
import { BlackboardGrpcService } from "./blackboard/blackboard-grpc.service";
import { BlackboardService } from "./blackboard/blackboard.service";
import { parseRedisHostPort } from "./config/blackboard-environment";
import { loadConversationManagerEnvironment } from "./config/environment";
import { loadConversationDispatchEnvironment } from "./config/conversation-dispatch-environment";
import { loadWhatsappWebhookEnvironment } from "./config/whatsapp-webhook-environment";
import { loadNodeexecEnvironment } from "./config/nodeexec-environment";
import { SANDBOX_CLIENT_PROTO_PATH } from "./registry/sandbox-client.constants";
import { ORCHESTRATION_MIGRATIONS_PATH } from "./database/migrations-path";
import { HealthController } from "./health/health.controller";
import { RecoveryPolicyService } from "./recovery/recovery-policy.service";
import { RecoveryDispatchService } from "./recovery/recovery-dispatch.service";
import { PostgresRecoveryRunReader } from "./recovery/recovery-run-reader";
import { RecoveryTriggerService } from "./recovery/recovery-trigger.service";
import { loadRecoveryEnvironment } from "./config/recovery-environment";
import { TriggerRegistryController } from "./trigger-registry/trigger-registry.controller";
import { TriggerRegistryService } from "./trigger-registry/trigger-registry.service";
import { WorkflowReadController } from "./workflow-read/workflow-read.controller";
import { WorkflowReadService } from "./workflow-read/workflow-read.service";
import { ProjectReadController } from "./project-read/project-read.controller";
import { ProjectReadService } from "./project-read/project-read.service";
import { TOOLGW_CLIENT_PROTO_PATH } from "./registry/nodeexec-grpc.constants";
import { ConversationDispatchService } from "./webhooks/conversation-dispatch.service";
import { WhatsappWebhookController } from "./webhooks/whatsapp-webhook.controller";
import { WhatsappWebhookService } from "./webhooks/whatsapp-webhook.service";
import { WhatsappAccountRegistryService } from "./webhooks/whatsapp-account-registry.service";
import { WhatsappAccountsController } from "./webhooks/whatsapp-accounts.controller";
import {
  DeletionController,
  ORCHESTRATION_DELETION_TOKEN_HASH,
} from "./deletion/deletion.controller";
import { OrchestrationDeletionService } from "./deletion/deletion.service";
import { DeletionRequestController } from "./deletion/deletion-request.controller";
import { ArtifactsController } from "./artifacts/artifacts.controller";
import { ArtifactsService } from "./artifacts/artifacts.service";
import { ArtifactContentGrpcService } from "./artifacts/artifact-content-grpc.service";

@Module({
  controllers: [
    HealthController,
    ConversationGrpcController,
    CompilerGrpcController,
    DeployctlGrpcController,
    RegistryGrpcController,
    NodeexecGrpcController,
    BlackboardGrpcController,
    RecoveryGrpcController,
    RunsGrpcController,
    ArtifactContentGrpcController,
    NodeExecutionsController,
    RunStreamController,
    RunsController,
    RunLearningController,
    ApprovalsController,
    TriggerRegistryController,
    WorkflowReadController,
    ProjectReadController,
    ArtifactsController,
    WhatsappWebhookController,
    WhatsappAccountsController,
    DeletionController,
    DeletionRequestController,
  ],
  providers: [
    {
      provide: ARTIFACT_CONTENT_HANDLER,
      useFactory: (artifacts: ArtifactsService) => new ArtifactContentGrpcService(artifacts),
      inject: [ArtifactsService],
    },
    {
      provide: WhatsappAccountRegistryService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        return new WhatsappAccountRegistryService(new PostgresOrchestrationStoreProvider({
          authentication: "iam", host: dbConfig.databaseHost, port: dbConfig.databasePort,
          database: dbConfig.databaseName, user: dbConfig.databaseUser, region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        }));
      },
    },
    {
      provide: ORCHESTRATION_DELETION_TOKEN_HASH,
      useFactory: () => requireSha256Fingerprint(
        process.env.DELETION_SERVICE_TOKEN_SHA256,
        "DELETION_SERVICE_TOKEN_SHA256",
      ),
    },
    {
      provide: OrchestrationDeletionService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const tenantStore = new PostgresOrchestrationStoreProvider({
          authentication: "iam", host: dbConfig.databaseHost, port: dbConfig.databasePort,
          database: dbConfig.databaseName, user: dbConfig.databaseUser, region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const deletionDatabaseUser = process.env.DELETION_DATABASE_USER?.trim();
        if (deletionDatabaseUser === undefined || deletionDatabaseUser.length === 0) {
          throw new Error("DELETION_DATABASE_USER is required for internal deletion sweeps");
        }
        const systemStore = new PostgresOrchestrationStoreProvider({
          authentication: "iam", host: dbConfig.databaseHost, port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: deletionDatabaseUser,
          region: dbConfig.awsRegion, migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        return new OrchestrationDeletionService(tenantStore, systemStore);
      },
    },
    {
      provide: APP_GUARD,
      useFactory: () => {
        const config = sessionGatewayEnvironment(process.env);
        const replayStore = new RedisReplayStore(
          new RedisRespSetClient(config.redisUrl),
        );
        return new SessionGatewayGuard(
          new M2mValidator({
            auth0Domain: config.auth0Domain,
            apiAudience: config.apiAudience,
          }),
          new ActorTokenValidator(
            {
              issuer: config.actorTokenIssuer,
              audience: config.actorTokenAudience,
              jwksUrl: config.actorTokenJwksUrl,
            },
            replayStore,
          ),
          new PostgresOrchestrationStoreProvider({
            authentication: "iam",
            host: config.databaseHost,
            port: config.databasePort,
            database: config.databaseName,
            user: config.databaseUser,
            region: config.awsRegion,
            migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
          }),
        );
      },
    },
    {
      provide: CONVERSATION_HANDLER,
      useFactory: () => {
        // Session Gateway's own PostgresOrchestrationStoreProvider (above)
        // isn't reachable from this factory -- its instance lives entirely
        // inside the APP_GUARD factory's closure, and INGR-2's guard
        // wiring is out of scope to refactor here. This constructs a
        // second provider (its own Pool) against the same database. Not
        // maximally efficient, but correct and isolated; sharing a single
        // pool across both is a reasonable follow-up once the guard
        // wiring itself is revisited.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const conversationConfig = loadConversationManagerEnvironment(
          process.env,
        );
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const modelGateway = new ModelGatewayClient({
          address: conversationConfig.modelGatewayAddress,
          protoPath: MODELGW_CLIENT_PROTO_PATH,
        });
        return new ConversationManagerService(store, modelGateway);
      },
    },
    {
      provide: TriggerRegistryService,
      useFactory: () => {
        // Same reasoning as CONVERSATION_HANDLER above: the guard's store
        // instance is not reachable from this factory, so this constructs
        // its own PostgresOrchestrationStoreProvider against the same
        // database rather than refactoring the guard wiring.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        return new TriggerRegistryService(store);
      },
    },
    {
      provide: WorkflowReadService,
      useFactory: () => {
        // Same reasoning as TriggerRegistryService above: constructs its
        // own PostgresOrchestrationStoreProvider rather than reaching into
        // the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        return new WorkflowReadService(store);
      },
    },
    {
      provide: ProjectReadService,
      useFactory: () => {
        // Same reasoning as WorkflowReadService above.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        return new ProjectReadService(store);
      },
    },
    {
      provide: ArtifactsService,
      useFactory: async () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const parameterStore = new AwsSsmParameterProvider({ region: dbConfig.awsRegion });
        try {
          const bucketName = await parameterStore.getParameter(dbConfig.artifactsBucketParameter);
          return new ArtifactsService(store, new S3ObjectStorageProvider({ region: dbConfig.awsRegion }), bucketName);
        } finally {
          parameterStore.close();
        }
      },
    },
    {
      provide: COMPILER_HANDLER,
      useFactory: () => {
        // Same reasoning as CONVERSATION_HANDLER/TriggerRegistryService
        // above: constructs its own PostgresOrchestrationStoreProvider
        // rather than reaching into the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        return new GraphCompilerService(store);
      },
    },
    {
      provide: DEPLOYCTL_HANDLER,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        return new DeploymentControllerService(store);
      },
    },
    {
      // No PostgresOrchestrationStoreProvider here -- the Node Type
      // Registry is a global, tenant-free static catalog (see
      // node-type-catalog.ts), not database-backed.
      provide: REGISTRY_HANDLER,
      useClass: RegistryService,
    },
    {
      provide: NODEEXEC_HANDLER,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const conversationConfig = loadConversationManagerEnvironment(
          process.env,
        );
        const modelGateway = new ModelGatewayClient({
          address: conversationConfig.modelGatewayAddress,
          protoPath: MODELGW_CLIENT_PROTO_PATH,
        });
        const nodeexecConfig = loadNodeexecEnvironment(process.env);
        const toolGateway = new ToolGatewayClient({
          address: nodeexecConfig.toolGatewayAddress,
          protoPath: TOOLGW_CLIENT_PROTO_PATH,
        });
        const sandboxService = new SandboxServiceClient({
          address: nodeexecConfig.sandboxServiceAddress,
          protoPath: SANDBOX_CLIENT_PROTO_PATH,
        });
        // No real QueueProvider adapter exists yet -- PubSubHandler uses
        // the shared-clients mock here, same disclosed gap as EXEC-1.
        const queueProvider = createMockQueueProvider();
        // HumanApprovalHandler needs only createPending's capability, under
        // its own narrower method name -- a thin adapter over a full
        // ApprovalsService instance built the same way every other factory
        // here builds its own store/provider, never reaching into another
        // factory's closure.
        const runLauncherConfig = loadRunLauncherEnvironment(process.env);
        const approvalsService = new ApprovalsService(
          store,
          new TemporalDurableExecutionProvider({
            address: runLauncherConfig.temporalAddress,
            namespace: runLauncherConfig.temporalNamespace,
            taskQueue: runLauncherConfig.taskQueue,
            ...(runLauncherConfig.temporalApiKey === undefined
              ? {}
              : { apiKey: runLauncherConfig.temporalApiKey }),
          }),
        );
        const registry = createRuntimeNodeHandlerRegistry({
          modelGateway,
          toolGateway,
          sandboxService,
          queueProvider,
          approvalRequester: {
            requestApproval: async (request) => {
              const created = await approvalsService.createPending(request);
              return { approvalId: created.id, expiryAt: created.expiryAt };
            },
          },
          verificationGateReader: new PostgresVerificationGateReader(store),
        });
        const ledger = new NodeExecutionLedgerService(store);
        const recoveryPolicy = buildRecoveryPolicyService();
        const recoveryTrigger = new RecoveryTriggerService(recoveryPolicy, recoveryPolicy);
        return new NodeexecService(
          registry,
          ledger,
          new RunStreamEventService(store),
          recoveryTrigger,
          buildRunOutcomeService(),
        );
      },
    },
    {
      provide: RECOVERY_HANDLER,
      useFactory: () => buildRecoveryPolicyService(),
    },
    {
      provide: RUNS_HANDLER,
      useFactory: () => {
        // Own store instance, same reasoning as every other factory here
        // (see the ApprovalsService comment above): not maximally
        // efficient, but correct and isolated.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const lookup = new RunWorkspaceLookupService(store);
        return {
          getRunWorkspace: async (request: { tenant_id: string; run_id: string }) => {
            const run = await lookup.getRunWorkspace(request.tenant_id, request.run_id);
            return { workspace_id: run.workspaceId, workflow_id: run.workflowId };
          },
          getNodeExecutionRecoveryInfo: async (request: {
            tenant_id: string;
            run_id: string;
            node_execution_id: string;
          }) => {
            const info = await lookup.getRecoveryInfo(
              request.tenant_id,
              request.run_id,
              request.node_execution_id,
            );
            return { is_retry: info.isRetry, is_recovery: info.isRecovery };
          },
        };
      },
    },
    {
      provide: NodeExecutionLedgerService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        return new NodeExecutionLedgerService(store);
      },
    },
    {
      provide: RunStreamEventService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        return new RunStreamEventService(new PostgresOrchestrationStoreProvider({
          authentication: "iam", host: dbConfig.databaseHost, port: dbConfig.databasePort,
          database: dbConfig.databaseName, user: dbConfig.databaseUser, region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        }));
      },
    },
    {
      provide: RunLauncherService,
      useFactory: () => {
        // Same reasoning as CONVERSATION_HANDLER/TriggerRegistryService
        // above: constructs its own PostgresOrchestrationStoreProvider
        // rather than reaching into the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const runLauncherConfig = loadRunLauncherEnvironment(process.env);
        const durable = new TemporalDurableExecutionProvider({
          address: runLauncherConfig.temporalAddress,
          namespace: runLauncherConfig.temporalNamespace,
          taskQueue: runLauncherConfig.taskQueue,
          ...(runLauncherConfig.temporalApiKey === undefined
            ? {}
            : { apiKey: runLauncherConfig.temporalApiKey }),
        });
        return new RunLauncherService(store, durable, buildRunOutcomeService());
      },
    },
    {
      provide: RunOutcomeService,
      useFactory: () => buildRunOutcomeService(),
    },
    {
      provide: ApprovalsService,
      useFactory: () => {
        // Same reasoning as CONVERSATION_HANDLER/TriggerRegistryService
        // above: constructs its own PostgresOrchestrationStoreProvider
        // rather than reaching into the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const runLauncherConfig = loadRunLauncherEnvironment(process.env);
        const durable = new TemporalDurableExecutionProvider({
          address: runLauncherConfig.temporalAddress,
          namespace: runLauncherConfig.temporalNamespace,
          taskQueue: runLauncherConfig.taskQueue,
          ...(runLauncherConfig.temporalApiKey === undefined
            ? {}
            : { apiKey: runLauncherConfig.temporalApiKey }),
        });
        return new ApprovalsService(store, durable);
      },
    },
    {
      provide: BLACKBOARD_HANDLER,
      useFactory: () => {
        // Same reasoning as CONVERSATION_HANDLER/TriggerRegistryService
        // above: constructs its own PostgresOrchestrationStoreProvider
        // rather than reaching into the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const cache = new RedisCacheProvider(
          parseRedisHostPort(dbConfig.redisUrl),
        );
        const blackboard = new BlackboardService(store, cache);
        return new BlackboardGrpcService(blackboard);
      },
    },
    {
      provide: WhatsappWebhookService,
      useFactory: () => {
        // Same reasoning as CONVERSATION_HANDLER/TriggerRegistryService
        // above: constructs its own PostgresOrchestrationStoreProvider
        // rather than reaching into the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const whatsappConfig = loadWhatsappWebhookEnvironment(process.env);
        return new WhatsappWebhookService(
          store,
          whatsappConfig,
          undefined,
          new WhatsappAccountRegistryService(store),
        );
      },
    },
    {
      provide: ConversationDispatchService,
      useFactory: () => {
        // Same reasoning as WhatsappWebhookService above: constructs its
        // own PostgresOrchestrationStoreProvider rather than reaching into
        // the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = new PostgresOrchestrationStoreProvider({
          authentication: "iam",
          host: dbConfig.databaseHost,
          port: dbConfig.databasePort,
          database: dbConfig.databaseName,
          user: dbConfig.databaseUser,
          region: dbConfig.awsRegion,
          migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
        });
        const dispatchConfig = loadConversationDispatchEnvironment(process.env);
        const dispatchClient = new ConversationDispatchClient({
          address: dispatchConfig.temporalAddress,
          namespace: dispatchConfig.temporalNamespace,
          taskQueue: dispatchConfig.taskQueue,
          ...(dispatchConfig.temporalApiKey === undefined
            ? {}
            : { apiKey: dispatchConfig.temporalApiKey }),
        });
        return new ConversationDispatchService(store, dispatchClient, {
          taskQueue: dispatchConfig.taskQueue,
          idleTimeoutSeconds: dispatchConfig.idleTimeoutSeconds,
        });
      },
    },
  ],
})
export class AppModule {}

interface SessionGatewayEnvironment {
  readonly auth0Domain: string;
  readonly apiAudience: string;
  readonly actorTokenIssuer: string;
  readonly actorTokenAudience: string;
  readonly actorTokenJwksUrl: string;
  readonly redisUrl: string;
  readonly databaseHost: string;
  readonly databasePort: number;
  readonly databaseName: string;
  readonly databaseUser: string;
  readonly awsRegion: string;
  readonly artifactsBucketParameter: string;
}

/**
 * HEAL-8: NodeexecService, RunLauncherService, and RunsController (via its
 * own RunOutcomeService provider below) all need a RunOutcomeService --
 * the real writer for the VACR/VADR metric ledger, and the reader behind
 * GET /runs/{id}/outcome. Same reasoning as buildRecoveryPolicyService
 * just below: each caller gets its own store instance.
 */
function buildRunOutcomeService(): RunOutcomeService {
  const dbConfig = sessionGatewayEnvironment(process.env);
  const store = new PostgresOrchestrationStoreProvider({
    authentication: "iam",
    host: dbConfig.databaseHost,
    port: dbConfig.databasePort,
    database: dbConfig.databaseName,
    user: dbConfig.databaseUser,
    region: dbConfig.awsRegion,
    migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
  });
  return new RunOutcomeService(store);
}

/**
 * HEAL-6: both the RECOVERY_HANDLER gRPC factory and NodeexecService's
 * factory need a fully-wired RecoveryPolicyService (the latter to trigger
 * recovery automatically when a node blocks). Each factory in this file
 * builds its own store/provider instances rather than sharing another
 * factory's closure (same rule ApprovalsService already follows above) --
 * this just avoids repeating the wiring verbatim twice in one file.
 */
function buildRecoveryPolicyService(): RecoveryPolicyService {
  const dbConfig = sessionGatewayEnvironment(process.env);
  const store = new PostgresOrchestrationStoreProvider({
    authentication: "iam",
    host: dbConfig.databaseHost,
    port: dbConfig.databasePort,
    database: dbConfig.databaseName,
    user: dbConfig.databaseUser,
    region: dbConfig.awsRegion,
    migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
  });
  const modelConfig = loadConversationManagerEnvironment(process.env);
  const modelGateway = new ModelGatewayClient({
    address: modelConfig.modelGatewayAddress,
    protoPath: MODELGW_CLIENT_PROTO_PATH,
  });
  const recoveryConfig = loadRecoveryEnvironment(process.env);
  const compiler = new GraphCompilerService(store);
  const planner = new PlannerClient({ baseUrl: recoveryConfig.plannerBaseUrl });
  const policyStoreClient = new PolicyStoreClient({
    baseUrl: recoveryConfig.memoryServiceBaseUrl,
  });
  const runLauncherConfig = loadRunLauncherEnvironment(process.env);
  const durable = new TemporalDurableExecutionProvider({
    address: runLauncherConfig.temporalAddress,
    namespace: runLauncherConfig.temporalNamespace,
    taskQueue: runLauncherConfig.taskQueue,
    ...(runLauncherConfig.temporalApiKey === undefined
      ? {}
      : { apiKey: runLauncherConfig.temporalApiKey }),
  });
  const approvals = new ApprovalsService(store, durable);
  const runReader = new PostgresRecoveryRunReader(store);
  // OUT-3: real "degrade" target needs the Blackboard (in-process here,
  // same as BLACKBOARD_HANDLER's own factory above -- no gRPC hop needed,
  // this service and BlackboardService share a process) and the same
  // VerificationGateReader gate.handler.ts/synthesis.handler.ts already
  // use to classify each upstream input's real verification verdict.
  const blackboardCache = new RedisCacheProvider(parseRedisHostPort(dbConfig.redisUrl));
  const blackboard = new BlackboardService(store, blackboardCache);
  const verificationReader = new PostgresVerificationGateReader(store);
  const dispatch = new RecoveryDispatchService(
    modelGateway,
    compiler,
    planner,
    approvals,
    runReader,
    durable,
    blackboard,
    verificationReader,
  );
  return new RecoveryPolicyService(
    store,
    modelGateway,
    dispatch,
    undefined,
    policyStoreClient,
  );
}

function requireSha256Fingerprint(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(normalized)) {
    throw new Error(`${field} must be a 64-character SHA-256 fingerprint`);
  }
  return normalized;
}

function sessionGatewayEnvironment(
  env: NodeJS.ProcessEnv,
): SessionGatewayEnvironment {
  assertProductionSessionGatewayConfiguration(env);

  return {
    auth0Domain: requiredEnvironment(env, "AUTH0_DOMAIN"),
    apiAudience: requiredEnvironment(env, "AUTH0_API_AUDIENCE"),
    actorTokenIssuer: requiredEnvironment(env, "ACTOR_TOKEN_ISSUER"),
    actorTokenAudience: requiredEnvironment(env, "ACTOR_TOKEN_AUDIENCE"),
    actorTokenJwksUrl: requiredEnvironment(env, "ACTOR_TOKEN_JWKS_URL"),
    redisUrl: requiredEnvironment(env, "REDIS_ENDPOINT"),
    databaseHost: requiredEnvironment(env, "ORCHESTRATION_DATABASE_HOST"),
    databasePort: requiredPort(env, "ORCHESTRATION_DATABASE_PORT"),
    databaseName: requiredEnvironment(env, "ORCHESTRATION_DATABASE_NAME"),
    databaseUser: requiredEnvironment(env, "ORCHESTRATION_DATABASE_USER"),
    awsRegion: requiredEnvironment(env, "AWS_REGION"),
    artifactsBucketParameter: requiredEnvironment(env, "ALTER_ARTIFACTS_BUCKET_PARAM"),
  };
}

function assertProductionSessionGatewayConfiguration(
  env: NodeJS.ProcessEnv,
): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  if (env.INGRESS_SESSION_GATEWAY_CORE_ENABLED !== "true") {
    throw new Error(
      "Production Session Gateway requires feature flag ingress.sessionGatewayCore",
    );
  }
  if (env.ACTOR_TOKEN_TEST_SIGNER_ENABLED === "true") {
    throw new Error("Actor-token test signer cannot be enabled in production");
  }
}

function requiredEnvironment(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required Session Gateway configuration: ${name}`);
  }
  return value;
}

function requiredPort(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(requiredEnvironment(env, name));
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(
      `Invalid Session Gateway configuration: ${name} must be a port`,
    );
  }
  return value;
}
