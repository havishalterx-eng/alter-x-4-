import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { Module, type DynamicModule } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import {
  CONVERSATION_HANDLER,
  ConversationGrpcController,
  ModelGatewayClient,
  startConversationGrpcTransport,
} from "@alterx/adapters";

import { CONVERSATION_PROTO_PATH, MODELGW_CLIENT_PROTO_PATH } from "./conversation/grpc.constants";
import {
  ConversationManagerService,
  type OrchestrationTenantStore,
} from "./conversation/conversation-manager.service";

/**
 * Real, disclosed eval-only entrypoint for HARD-7e (`intent` golden-set
 * domain) -- NOT orchestration-service's production main.ts, which boots
 * its entire app.module.ts (every handler, every DB pool, Temporal,
 * Planner, PolicyStore) as one eager unit. classifyIntent() only ever
 * needs ConversationManagerService + a real ModelGatewayHandler -- it
 * never touches `store` (see conversation-manager.service.ts's own
 * classifyIntent body: no `this.store` call anywhere in it) -- so this
 * constructs that one real service directly, same pattern
 * ingress-phase-exit-check.spec.ts already uses for testing other
 * orchestration-service logic without booting the full monolith.
 *
 * `store` is a real, honestly-unreachable stub: it throws if ever called,
 * rather than silently returning fake data, so a future change that makes
 * classifyIntent touch the store fails loudly here instead of silently
 * appearing to work. Never used by ClassifyIntent today.
 *
 * ModelGatewayHandler points at a real, live model-gateway gRPC server --
 * apps/model-gateway/src/eval_bootstrap.ts (HARD-7d), which makes a real
 * Anthropic/OpenAI call from a plain env var API key, not AWS Secrets
 * Manager (unavailable in this environment). The LLM call this script
 * makes is real; only where model-gateway itself is bootstrapped from
 * differs from production.
 */
const unreachableStore: OrchestrationTenantStore = {
  withTenant<T>(): Promise<T> {
    throw new Error(
      "eval_intent_grpc_server's store is a disclosed, intentionally-unreachable stub -- " +
        "classifyIntent must never call it. If this throws, something now depends on the " +
        "store that didn't before, and that's a real, disclosed gap, not a bug in this script.",
    );
  },
};

@Module({})
class EvalIntentModule {
  static register(modelGatewayTarget: string): DynamicModule {
    const modelGateway = new ModelGatewayClient({
      address: modelGatewayTarget,
      protoPath: MODELGW_CLIENT_PROTO_PATH,
    });
    return {
      module: EvalIntentModule,
      controllers: [ConversationGrpcController],
      providers: [
        {
          provide: CONVERSATION_HANDLER,
          useValue: new ConversationManagerService(unreachableStore, modelGateway),
        },
      ],
    };
  }
}

async function bootstrap(): Promise<void> {
  const modelGatewayTarget = process.env.MODEL_GATEWAY_GRPC_TARGET;
  if (modelGatewayTarget === undefined || modelGatewayTarget.length === 0) {
    throw new Error("eval_intent_grpc_server requires MODEL_GATEWAY_GRPC_TARGET");
  }
  const bindAddress = process.env.GRPC_BIND_ADDRESS;
  if (bindAddress === undefined || bindAddress.length === 0) {
    throw new Error("eval_intent_grpc_server requires GRPC_BIND_ADDRESS");
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    EvalIntentModule.register(modelGatewayTarget),
    new FastifyAdapter(),
  );
  await startConversationGrpcTransport(app, {
    bindAddress,
    protoPath: CONVERSATION_PROTO_PATH,
  });
  app.enableShutdownHooks();
  const httpPort = process.env.HTTP_PORT === undefined ? 0 : Number(process.env.HTTP_PORT);
  await app.listen(httpPort, "127.0.0.1");
}

void bootstrap();
