import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import {
  BLACKBOARD_HANDLER,
  COMPILER_HANDLER,
  CONVERSATION_HANDLER,
  DEPLOYCTL_HANDLER,
  NODEEXEC_HANDLER,
  REGISTRY_HANDLER,
  BlackboardGrpcController,
  CompilerGrpcController,
  ConversationDispatchClient,
  ConversationGrpcController,
  DeployctlGrpcController,
  ModelGatewayClient,
  SandboxServiceClient,
  NodeexecGrpcController,
  PostgresOrchestrationStoreProvider,
  RedisCacheProvider,
  RegistryGrpcController,
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
import { loadRunLauncherEnvironment } from "./config/run-launcher-environment";
import { createRuntimeNodeHandlerRegistry } from "./registry/node-handler-registry";
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
import { TriggerRegistryController } from "./trigger-registry/trigger-registry.controller";
import { TriggerRegistryService } from "./trigger-registry/trigger-registry.service";
import { TOOLGW_CLIENT_PROTO_PATH } from "./registry/nodeexec-grpc.constants";
import { ConversationDispatchService } from "./webhooks/conversation-dispatch.service";
import { WhatsappWebhookController } from "./webhooks/whatsapp-webhook.controller";
import { WhatsappWebhookService } from "./webhooks/whatsapp-webhook.service";

@Module({
  controllers: [
    HealthController,
    ConversationGrpcController,
    CompilerGrpcController,
    DeployctlGrpcController,
    RegistryGrpcController,
    NodeexecGrpcController,
    BlackboardGrpcController,
    NodeExecutionsController,
    RunStreamController,
    RunsController,
    TriggerRegistryController,
    WhatsappWebhookController,
  ],
  providers: [
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
        const registry = createRuntimeNodeHandlerRegistry({
          modelGateway,
          toolGateway,
          sandboxService,
          queueProvider,
        });
        const ledger = new NodeExecutionLedgerService(store);
        return new NodeexecService(registry, ledger, new RunStreamEventService(store));
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
        return new RunLauncherService(store, durable);
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
        return new WhatsappWebhookService(store, whatsappConfig);
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
