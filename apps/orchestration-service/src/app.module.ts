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
  RUNS_DISPATCH_HANDLER,
  BlackboardGrpcController,
  ARTIFACT_CONTENT_HANDLER,
  ArtifactContentGrpcController,
  CapabilityServiceClient,
  CompilerGrpcController,
  ConversationDispatchClient,
  ConversationGrpcController,
  DeployctlGrpcController,
  EvalServiceClient,
  EventBridgeEventPublisher,
  MemoryServiceClient,
  ModelGatewayClient,
  PerformanceRecorderClient,
  PlannerClient,
  PolicyStoreClient,
  ProvisioningClient,
  RunDispatchGrpcController,
  SandboxServiceClient,
  SelectionBindingClient,
  AwsSecretsManagerProvider,
  AwsSsmParameterProvider,
  S3ObjectStorageProvider,
  NodeexecGrpcController,
  RedisCacheProvider,
  RecoveryGrpcController,
  RegistryGrpcController,
  RunsGrpcController,
  TemporalDurableExecutionProvider,
  ToolGatewayClient,
  VerifyServiceClient,
} from "@alterx/adapters";
import { createMockQueueProvider } from "@alterx/shared-clients";
import {
  ActorTokenValidator,
  M2mValidator,
  RedisReplayStore,
  RedisRespSetClient,
  SessionGatewayGuard,
  SessionGatewayRateLimitGuard,
  SessionGatewayUploadAllowlistGuard,
} from "@alterx/auth";
import { MODELGW_CLIENT_PROTO_PATH } from "./conversation/grpc.constants";
import { ConversationManagerService } from "./conversation/conversation-manager.service";
import { GraphCompilerService } from "./compiler/graph-compiler.service";
import { CAPABILITY_CLIENT_PROTO_PATH } from "./compiler/capability-client.constants";
import { WorkflowLifecycleService } from "./workflow-lifecycle/workflow-lifecycle.service";
import { WorkflowDeploymentController } from "./workflow-lifecycle/workflow-deployment.controller";
import {
  DEPLOYMENT_ADMIN_TOKEN_HASH,
  DeploymentAdminController,
} from "./deployment-admin/deployment-admin.controller";
import { DeploymentAdminService } from "./deployment-admin/deployment-admin.service";
import { RegistryService } from "./registry/registry.service";
import { NodeexecService } from "./registry/nodeexec.service";
import { SsmSelectionBindingFailClosedConfig } from "./registry/selection-binding-fail-closed-config";
import { NodeExecutionsController } from "./runs/node-executions.controller";
import { NodeExecutionLedgerService } from "./runs/node-execution-ledger.service";
import { RunStreamEventService } from "./runs/run-stream-event.service";
import { RunStreamController } from "./runs/run-stream.controller";
import { RunLauncherService } from "./runs/run-launcher.service";
import { DurableRunQueue } from "./runs/durable-run-queue.service";
import { RunsController } from "./runs/runs.controller";
import { RunOutcomeService } from "./runs/run-outcome.service";
import { ProjectRunProvisioningService } from "./runs/project-run-provisioning.service";
import { RunWorkspaceLookupService } from "./runs/run-workspace-lookup.service";
import { PROVISIONING_CLIENT_PROTO_PATH } from "./runs/provisioning-client.constants";
import { RunLearningController } from "./runs/run-learning.controller";
import { RunObservabilityController } from "./runs/run-observability.controller";
import { RunObservabilityService } from "./runs/run-observability.service";
import { loadRunLauncherEnvironment } from "./config/run-launcher-environment";
import { ApprovalsController } from "./approvals/approvals.controller";
import { ApprovalsService } from "./approvals/approvals.service";
import { EscalationsController } from "./escalations/escalations.controller";
import { EscalationsService } from "./escalations/escalations.service";
import { createRuntimeNodeHandlerRegistry } from "./registry/node-handler-registry";
import { PostgresVerificationGateReader } from "./registry/verification-gate-reader";
import { PostgresRunFinalizationMemoryWriter } from "./registry/run-finalization-memory-writer";
import { BlackboardGrpcService } from "./blackboard/blackboard-grpc.service";
import { BlackboardService } from "./blackboard/blackboard.service";
import { parseRedisHostPort } from "./config/blackboard-environment";
import { loadConversationManagerEnvironment } from "./config/environment";
import { loadConversationDispatchEnvironment } from "./config/conversation-dispatch-environment";
import { loadWhatsappWebhookEnvironment } from "./config/whatsapp-webhook-environment";
import { loadNodeexecEnvironment } from "./config/nodeexec-environment";
import { SANDBOX_CLIENT_PROTO_PATH } from "./registry/sandbox-client.constants";
import {
  OrchestrationInfrastructureModule,
  internalM2mTokenProvider,
  orchestrationStore,
  sessionGatewayEnvironment,
} from "./orchestration-infrastructure.module";
import { HealthController } from "./health/health.controller";
import { RecoveryPolicyService } from "./recovery/recovery-policy.service";
import { RecoveryDispatchService } from "./recovery/recovery-dispatch.service";
import { PostgresRecoveryRunReader } from "./recovery/recovery-run-reader";
import { RecoveryTriggerService } from "./recovery/recovery-trigger.service";
import { loadRecoveryEnvironment } from "./config/recovery-environment";
import { TriggerRegistryController } from "./trigger-registry/trigger-registry.controller";
import { TriggerRegistryService } from "./trigger-registry/trigger-registry.service";
import { TriggerEventDispatchService } from "./trigger-registry/trigger-event-dispatch.service";
import { loadTriggerDispatchEnvironment } from "./config/trigger-dispatch-environment";
import {
  IntegrationWebhookController,
  PostgresTriggerBindingStore,
  TriggerBindingController,
  TriggerBindingService,
  WebhookEndpointController,
  loadTriggerBindingEnvironment,
} from "./trigger-bindings";
import { WorkflowReadController } from "./workflow-read/workflow-read.controller";
import { NodeTypeController } from "./registry/node-type.controller";
import { WorkflowReadService } from "./workflow-read/workflow-read.service";
import { TemplateVariablesController } from "./template-variables/template-variables.controller";
import { TemplateVariablesService } from "./template-variables/template-variables.service";
import { ClarificationsController } from "./clarifications/clarifications.controller";
import { ClarificationsService } from "./clarifications/clarifications.service";
import { ProjectReadController } from "./project-read/project-read.controller";
import { ProjectReadService } from "./project-read/project-read.service";
import { ProjectDomainService } from "./project-read/project-domain.service";
import { MEMORY_CLIENT_PROTO_PATH, TOOLGW_CLIENT_PROTO_PATH, VERIFY_CLIENT_PROTO_PATH } from "./registry/nodeexec-grpc.constants";
import { VerifyGateService } from "./registry/verify-gate.service";
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
import { GeneratedFileMaterializer } from "./registry/generated-file-materializer";
import {
  EVAL_FACADE_CONFIG,
  loadEvalFacadeEnvironment,
  type EvalFacadeEnvironment,
} from "./eval-facade/config";
import {
  EvalFacadeController,
  EVAL_FACADE_TOKEN_HASH,
} from "./eval-facade/eval-facade.controller";
import { EvalFacadeService } from "./eval-facade/eval-facade.service";
import { EVAL_PROTO_PATH } from "./eval-facade/grpc.constants";

@Module({
  imports: [OrchestrationInfrastructureModule],
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
    RunDispatchGrpcController,
    ArtifactContentGrpcController,
    NodeExecutionsController,
    RunStreamController,
    RunsController,
    RunObservabilityController,
    RunLearningController,
    ApprovalsController,
    EscalationsController,
    TriggerRegistryController,
    TriggerBindingController,
    WebhookEndpointController,
    IntegrationWebhookController,
    WorkflowReadController,
    NodeTypeController,
    WorkflowDeploymentController,
    TemplateVariablesController,
    ClarificationsController,
    ProjectReadController,
    ArtifactsController,
    WhatsappWebhookController,
    WhatsappAccountsController,
    DeletionController,
    DeletionRequestController,
    EvalFacadeController,
    DeploymentAdminController,
  ],
  providers: [
    {
      provide: EVAL_FACADE_CONFIG,
      useFactory: () => loadEvalFacadeEnvironment(process.env),
    },
    {
      provide: EVAL_FACADE_TOKEN_HASH,
      inject: [EVAL_FACADE_CONFIG],
      useFactory: (config: EvalFacadeEnvironment) => config.tokenHash,
    },
    {
      provide: EvalServiceClient,
      inject: [EVAL_FACADE_CONFIG],
      useFactory: (config: EvalFacadeEnvironment) => new EvalServiceClient({
        address: config.grpcTarget,
        protoPath: EVAL_PROTO_PATH,
        authorization: process.env["INTERNAL_SERVICE_TOKEN"] ?? "",
      }),
    },
    EvalFacadeService,
    {
      provide: DEPLOYMENT_ADMIN_TOKEN_HASH,
      useFactory: () => requireSha256Fingerprint(
        process.env.DEPLOYMENT_ADMIN_SERVICE_TOKEN_SHA256,
        "DEPLOYMENT_ADMIN_SERVICE_TOKEN_SHA256",
      ),
    },
    {
      provide: DeploymentAdminService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        return new DeploymentAdminService(orchestrationStore(dbConfig));
      },
    },
    {
      provide: ARTIFACT_CONTENT_HANDLER,
      useFactory: (artifacts: ArtifactsService) => new ArtifactContentGrpcService(artifacts),
      inject: [ArtifactsService],
    },
    {
      provide: WhatsappAccountRegistryService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        return new WhatsappAccountRegistryService(orchestrationStore(dbConfig));
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
        const tenantStore = orchestrationStore(dbConfig);
        const deletionDatabaseUser = process.env.DELETION_DATABASE_USER?.trim();
        if (deletionDatabaseUser === undefined || deletionDatabaseUser.length === 0) {
          throw new Error("DELETION_DATABASE_USER is required for internal deletion sweeps");
        }
        const systemStore = orchestrationStore(dbConfig, deletionDatabaseUser);
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
            ...(config.auth0JwksUrl ? { jwksUrl: config.auth0JwksUrl } : {})
          }),
          new ActorTokenValidator(
            {
              issuer: config.actorTokenIssuer,
              audience: config.actorTokenAudience,
              jwksUrl: config.actorTokenJwksUrl,
            },
            replayStore,
          ),
          orchestrationStore(config),
        );
      },
    },
    {
      provide: APP_GUARD,
      useFactory: () => new SessionGatewayRateLimitGuard(),
    },
    {
      provide: APP_GUARD,
      useFactory: () => new SessionGatewayUploadAllowlistGuard(),
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
        const store = orchestrationStore(dbConfig);
        const modelGateway = new ModelGatewayClient({
          address: conversationConfig.modelGatewayAddress,
          protoPath: MODELGW_CLIENT_PROTO_PATH,
          accessTokenProvider: internalM2mTokenProvider(),
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
        const store = orchestrationStore(dbConfig);
        const runLauncherConfig = loadRunLauncherEnvironment(process.env);
        const durable = new TemporalDurableExecutionProvider({
          address: runLauncherConfig.temporalAddress,
          namespace: runLauncherConfig.temporalNamespace,
          taskQueue: runLauncherConfig.taskQueue,
          ...(runLauncherConfig.temporalApiKey === undefined
            ? {}
            : { apiKey: runLauncherConfig.temporalApiKey }),
        });
        // INGR-7: the same Temporal provider also owns cron trigger
        // Schedules. Its metadata claims the primary canonical interface
        // (DurableExecutionProvider); the CronScheduleManager capability
        // rides along structurally, so this is a boundary cast.
        return new TriggerRegistryService(
          store,
          undefined,
          durable as unknown as import("@alterx/shared-clients").CronScheduleManager,
        );
      },
    },
    {
      // ENG-BINDING. Same reasoning as TriggerRegistryService above:
      // constructs its own PostgresOrchestrationStoreProvider rather than
      // reaching into the guard's private instance.
      //
      // Signing secrets are held by AWS Secrets Manager, the only
      // MutableSecretsProvider wired in this repo. Nothing about the feature
      // depends on that choice -- TriggerBindingService takes the interface,
      // so swapping in another provider is a one-line change here.
      provide: TriggerBindingService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        const bindingConfig = loadTriggerBindingEnvironment(process.env);
        const dispatchConfig = loadTriggerDispatchEnvironment(process.env);
        return new TriggerBindingService(
          new PostgresTriggerBindingStore(store),
          new AwsSecretsManagerProvider({ region: dbConfig.awsRegion }),
          {
            webhookBaseUrl: bindingConfig.webhookBaseUrl,
            maxSkewSeconds: bindingConfig.maxSkewSeconds,
          },
          new EventBridgeEventPublisher({
            region: dbConfig.awsRegion,
            busName: dispatchConfig.eventBridgeBusName,
            ...(dispatchConfig.eventBridgeEndpoint === undefined
              ? {}
              : { endpoint: dispatchConfig.eventBridgeEndpoint }),
          }),
        );
      },
    },
    {
      provide: RUNS_DISPATCH_HANDLER,
      inject: [RunLauncherService],
      useFactory: (launcher: RunLauncherService) => {
        // Same reasoning as RUNS_HANDLER above: its own store instance,
        // isolated from the guard's.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        return new TriggerEventDispatchService(store, launcher);
      },
    },
    {
      provide: WorkflowReadService,
      useFactory: () => {
        // Same reasoning as TriggerRegistryService above: constructs its
        // own PostgresOrchestrationStoreProvider rather than reaching into
        // the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        return new WorkflowReadService(store);
      },
    },
    {
      provide: TemplateVariablesService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        return new TemplateVariablesService(orchestrationStore(dbConfig));
      },
    },
    {
      provide: ClarificationsService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        return new ClarificationsService(orchestrationStore(dbConfig));
      },
    },
    {
      provide: ProjectReadService,
      useFactory: () => {
        // Same reasoning as WorkflowReadService above.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        return new ProjectReadService(store);
      },
    },
    {
      provide: ProjectDomainService,
      inject: [RunLauncherService, CONVERSATION_HANDLER],
      useFactory: (launcher: RunLauncherService, conversations: import("@alterx/adapters").ConversationHandler) => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        const recoveryConfig = loadRecoveryEnvironment(process.env);
        return new ProjectDomainService(
          store,
          new PlannerClient({ baseUrl: recoveryConfig.plannerBaseUrl }),
          conversations,
          launcher,
        );
      },
    },
    {
      provide: ArtifactsService,
      useFactory: async () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
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
        const store = orchestrationStore(dbConfig);
        const recoveryConfig = loadRecoveryEnvironment(process.env);
        return new GraphCompilerService(store, new CapabilityServiceClient({
          address: recoveryConfig.capabilityResolverAddress,
          protoPath: CAPABILITY_CLIENT_PROTO_PATH,
          authorization: process.env["INTERNAL_SERVICE_TOKEN"] ?? "",
        }));
      },
    },
    {
      provide: WorkflowLifecycleService,
      useFactory: async (artifacts: ArtifactsService, evalFacade: EvalFacadeService) => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        const parameterStore = new AwsSsmParameterProvider({
          region: dbConfig.awsRegion,
        });
        try {
          const staticDeploymentBucket = await parameterStore.getParameter(
            dbConfig.artifactsBucketParameter,
          );
          return new WorkflowLifecycleService(store, evalFacade, {
            artifacts,
            objects: new S3ObjectStorageProvider({ region: dbConfig.awsRegion }),
            staticDeploymentBucket,
          });
        } finally {
          parameterStore.close();
        }
      },
      inject: [ArtifactsService, EvalFacadeService],
    },
    {
      provide: DEPLOYCTL_HANDLER,
      useExisting: WorkflowLifecycleService,
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
      useFactory: async (artifacts: ArtifactsService) => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        const conversationConfig = loadConversationManagerEnvironment(
          process.env,
        );
        const modelGateway = new ModelGatewayClient({
          address: conversationConfig.modelGatewayAddress,
          protoPath: MODELGW_CLIENT_PROTO_PATH,
          accessTokenProvider: internalM2mTokenProvider(),
        });
        const nodeexecConfig = loadNodeexecEnvironment(process.env);
        const toolGateway = new ToolGatewayClient({
          address: nodeexecConfig.toolGatewayAddress,
          protoPath: TOOLGW_CLIENT_PROTO_PATH,
          accessTokenProvider: internalM2mTokenProvider(),
        });
        const sandboxService = new SandboxServiceClient({
          address: nodeexecConfig.sandboxServiceAddress,
          protoPath: SANDBOX_CLIENT_PROTO_PATH,
          accessTokenProvider: internalM2mTokenProvider(),
        });
        const memoryService = new MemoryServiceClient({
          address: nodeexecConfig.memoryServiceAddress,
          protoPath: MEMORY_CLIENT_PROTO_PATH,
          authorization: nodeexecConfig.memoryServiceAuthorization,
        });
        const verifyGate = new VerifyGateService(
          new VerifyServiceClient({
            address: nodeexecConfig.verifyServiceAddress,
            protoPath: VERIFY_CLIENT_PROTO_PATH,
            authorization: process.env["INTERNAL_SERVICE_TOKEN"] ?? "",
          }),
        );
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
          memoryService,
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
        // Selection & Binding for LLMTask execution -- same Capability
        // Resolver gRPC target and intelligence-service FastAPI base URL
        // buildRecoveryPolicyService's swap_agent wiring already targets,
        // fresh instances per this factory's own no-shared-instances
        // convention. runWorkspaceLookup reuses this factory's own `store`,
        // same as the RUNS_HANDLER factory's own lookup below.
        const bindingConfig = loadRecoveryEnvironment(process.env);
        const capabilityResolverForNodeexec = new CapabilityServiceClient({
          address: bindingConfig.capabilityResolverAddress,
          protoPath: CAPABILITY_CLIENT_PROTO_PATH,
          authorization: process.env["INTERNAL_SERVICE_TOKEN"] ?? "",
        });
        const selectionBindingForNodeexec = new SelectionBindingClient({
          baseUrl: bindingConfig.plannerBaseUrl,
        });
        // performance_records writer -- same intelligence-service FastAPI
        // app Selection & Binding above already targets, just a different
        // route prefix.
        const performanceRecorder = new PerformanceRecorderClient({
          baseUrl: bindingConfig.plannerBaseUrl,
        });
        const runWorkspaceLookup = new RunWorkspaceLookupService(store);
        const selectionBindingFailClosed = new SsmSelectionBindingFailClosedConfig(
          new AwsSsmParameterProvider({ region: dbConfig.awsRegion }),
          dbConfig.selectionBindingFailClosedParameter,
        );
        const runFinalizationMemoryWriter = new PostgresRunFinalizationMemoryWriter(
          store,
          new PostgresVerificationGateReader(store),
          artifacts,
          memoryService,
        );
        return new NodeexecService(
          registry,
          ledger,
          new RunStreamEventService(store),
          recoveryTrigger,
          buildRunOutcomeService(),
          new ProjectRunProvisioningService(
            store,
            new ProvisioningClient({
              address: runLauncherConfig.provisioningServiceAddress,
              protoPath: PROVISIONING_CLIENT_PROTO_PATH,
              accessTokenProvider: internalM2mTokenProvider(),
            }),
          ),
          new GeneratedFileMaterializer(artifacts, sandboxService),
          verifyGate,
          runWorkspaceLookup,
          capabilityResolverForNodeexec,
          selectionBindingForNodeexec,
          performanceRecorder,
          selectionBindingFailClosed,
          runFinalizationMemoryWriter,
        );
      },
      inject: [ArtifactsService],
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
        const store = orchestrationStore(dbConfig);
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
        const store = orchestrationStore(dbConfig);
        return new NodeExecutionLedgerService(store);
      },
    },
    {
      provide: RunStreamEventService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        return new RunStreamEventService(orchestrationStore(dbConfig));
      },
    },
    {
      provide: RunObservabilityService,
      useFactory: () => {
        const dbConfig = sessionGatewayEnvironment(process.env);
        return new RunObservabilityService(orchestrationStore(dbConfig));
      },
    },
    {
      provide: RunLauncherService,
      useFactory: () => {
        // Same reasoning as CONVERSATION_HANDLER/TriggerRegistryService
        // above: constructs its own PostgresOrchestrationStoreProvider
        // rather than reaching into the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        const runLauncherConfig = loadRunLauncherEnvironment(process.env);
        const durable = new TemporalDurableExecutionProvider({
          address: runLauncherConfig.temporalAddress,
          namespace: runLauncherConfig.temporalNamespace,
          taskQueue: runLauncherConfig.taskQueue,
          ...(runLauncherConfig.temporalApiKey === undefined
            ? {}
            : { apiKey: runLauncherConfig.temporalApiKey }),
        });
        return new RunLauncherService(
          store,
          durable,
          buildRunOutcomeService(),
          new ProjectRunProvisioningService(
            store,
            new ProvisioningClient({
              address: runLauncherConfig.provisioningServiceAddress,
              protoPath: PROVISIONING_CLIENT_PROTO_PATH,
              accessTokenProvider: internalM2mTokenProvider(),
            }),
          ),
          new DurableRunQueue(store),
        );
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
        const store = orchestrationStore(dbConfig);
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
      provide: EscalationsService,
      useFactory: () => {
        // Same reasoning as ApprovalsService above: constructs its own
        // PostgresOrchestrationStoreProvider rather than reaching into the
        // guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
        return new EscalationsService(store);
      },
    },
    {
      provide: BLACKBOARD_HANDLER,
      useFactory: () => {
        // Same reasoning as CONVERSATION_HANDLER/TriggerRegistryService
        // above: constructs its own PostgresOrchestrationStoreProvider
        // rather than reaching into the guard's private instance.
        const dbConfig = sessionGatewayEnvironment(process.env);
        const store = orchestrationStore(dbConfig);
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
        const store = orchestrationStore(dbConfig);
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
        const store = orchestrationStore(dbConfig);
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

/**
 * HEAL-8: NodeexecService, RunLauncherService, and RunsController (via its
 * own RunOutcomeService provider below) all need a RunOutcomeService --
 * the real writer for the VACR/VADR metric ledger, and the reader behind
 * GET /runs/{id}/outcome. Same reasoning as buildRecoveryPolicyService
 * just below: each caller gets its own store instance.
 */
function buildRunOutcomeService(): RunOutcomeService {
  const dbConfig = sessionGatewayEnvironment(process.env);
  const store = orchestrationStore(dbConfig);
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
  const store = orchestrationStore(dbConfig);
  const modelConfig = loadConversationManagerEnvironment(process.env);
  const modelGateway = new ModelGatewayClient({
    address: modelConfig.modelGatewayAddress,
    protoPath: MODELGW_CLIENT_PROTO_PATH,
    accessTokenProvider: internalM2mTokenProvider(),
  });
  const recoveryConfig = loadRecoveryEnvironment(process.env);
  const compiler = new GraphCompilerService(store, new CapabilityServiceClient({
    address: recoveryConfig.capabilityResolverAddress,
    protoPath: CAPABILITY_CLIENT_PROTO_PATH,
    authorization: process.env["INTERNAL_SERVICE_TOKEN"] ?? "",
  }));
  const planner = new PlannerClient({ baseUrl: recoveryConfig.plannerBaseUrl });
  // swap_agent's real dispatch target -- same Capability Resolver gRPC
  // target `compiler` already uses (a fresh client instance, matching
  // this factory's own no-shared-instances convention), and Selection &
  // Binding lives on the same intelligence-service FastAPI app PlannerClient
  // already targets, just a different route prefix -- no new env var.
  const capabilityResolverForRecovery = new CapabilityServiceClient({
    address: recoveryConfig.capabilityResolverAddress,
    protoPath: CAPABILITY_CLIENT_PROTO_PATH,
    authorization: process.env["INTERNAL_SERVICE_TOKEN"] ?? "",
  });
  const selectionBinding = new SelectionBindingClient({ baseUrl: recoveryConfig.plannerBaseUrl });
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
    undefined,
    capabilityResolverForRecovery,
    selectionBinding,
  );
  const escalations = new EscalationsService(store);
  return new RecoveryPolicyService(
    store,
    modelGateway,
    dispatch,
    undefined,
    policyStoreClient,
    escalations,
  );
}

function requireSha256Fingerprint(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(normalized)) {
    throw new Error(`${field} must be a 64-character SHA-256 fingerprint`);
  }
  return normalized;
}
