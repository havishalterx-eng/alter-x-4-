import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { Module, type DynamicModule } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import {
  RECOVERY_HANDLER,
  RecoveryGrpcController,
  connectRecoveryGrpcTransport,
  PostgresOrchestrationStoreProvider,
  type ModelGatewayHandler,
} from "@alterx/adapters";
import { createMockCacheProvider } from "@alterx/shared-clients";
import { ApprovalsService, type ApprovalDecisionSignaler } from "./approvals/approvals.service";
import { BlackboardService } from "./blackboard/blackboard.service";
import {
  RecoveryDispatchService,
  type GraphCompilerHandler,
  type NodeRetrySignaler,
  type PlannerReplanHandler,
} from "./recovery/recovery-dispatch.service";
import { RECOVERY_PROTO_PATH } from "./recovery/grpc.constants";
import { RecoveryPolicyService } from "./recovery/recovery-policy.service";
import { PostgresRecoveryRunReader } from "./recovery/recovery-run-reader";
import { PostgresVerificationGateReader } from "./registry/verification-gate-reader";

/**
 * Real, disclosed eval-only entrypoint for HARD-7i (`recovery` golden-set
 * domain) -- NOT orchestration-service's production main.ts, which boots
 * every handler (runs, conversation, recovery, blackboard, ...) as one
 * eager unit against real Temporal + real Model Gateway + real Planner +
 * real Policy Store. This constructs only RecoveryPolicyService directly,
 * same "one real service, not the whole monolith" pattern
 * eval_intent_grpc_server.ts (HARD-7e) already uses.
 *
 * Scoped to the 5 of 12 real RECOVERY_CASES whose real dispatch path
 * (RecoveryDispatchService.dispatch()) never touches Temporal, a live
 * LLM, or Planner: "ask_user" (real DB-backed approvals row, see
 * #askUser -- never calls its own `durable` dependency) and "swap_agent"
 * (a real, disclosed "no target system wired yet" deferred outcome, see
 * dispatch()'s own comment -- touches nothing). The other 7 cases
 * (retry/backoff need a real Temporal nodeRetrySignaler,
 * escalate_model needs a real live LLM, replan/recompile need a real
 * Planner call) are real, disclosed follow-up scope, not built here.
 *
 * modelGateway/compiler/planner/nodeRetrySignaler are real, disclosed,
 * intentionally-unreachable stubs -- they throw if ever called, so a
 * future change that makes ask_user/swap_agent's dispatch touch one of
 * them fails loudly here instead of silently appearing to work. runs and
 * verificationReader are real (PostgresRecoveryRunReader /
 * PostgresVerificationGateReader), cheap once `store` exists, even
 * though the 5 target cases never call them either.
 */
function unreachable(name: string): never {
  throw new Error(
    `eval_recovery_grpc_server's ${name} is a disclosed, intentionally-unreachable stub -- ` +
      "ask_user/swap_agent dispatch must never call it. If this throws, something now depends " +
      "on it that didn't before, and that's a real, disclosed gap, not a bug in this script.",
  );
}

const unreachableModelGateway: ModelGatewayHandler = {
  invoke: () => unreachable("modelGateway"),
};
const unreachableCompiler: GraphCompilerHandler = {
  compileWorkflow: () => unreachable("compiler"),
};
const unreachablePlanner: PlannerReplanHandler = {
  replan: () => unreachable("planner"),
};
const unreachableNodeRetrySignaler: NodeRetrySignaler = {
  signalWorkflow: () => unreachable("nodeRetrySignaler"),
};
const unreachableApprovalDecisionSignaler: ApprovalDecisionSignaler = {
  signalWorkflow: () => unreachable("approvals' durable dependency"),
};

@Module({})
class EvalRecoveryModule {
  static register(store: PostgresOrchestrationStoreProvider): DynamicModule {
    const approvals = new ApprovalsService(store, unreachableApprovalDecisionSignaler);
    const runReader = new PostgresRecoveryRunReader(store);
    const blackboard = new BlackboardService(store, createMockCacheProvider());
    const verificationReader = new PostgresVerificationGateReader(store);
    const dispatch = new RecoveryDispatchService(
      unreachableModelGateway,
      unreachableCompiler,
      unreachablePlanner,
      approvals,
      runReader,
      unreachableNodeRetrySignaler,
      blackboard,
      verificationReader,
    );
    const policyService = new RecoveryPolicyService(store, unreachableModelGateway, dispatch);
    return {
      module: EvalRecoveryModule,
      controllers: [RecoveryGrpcController],
      providers: [{ provide: RECOVERY_HANDLER, useValue: policyService }],
    };
  }
}

async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.EVAL_RECOVERY_DB_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("eval_recovery_grpc_server requires EVAL_RECOVERY_DB_URL");
  }
  const bindAddress = process.env.GRPC_BIND_ADDRESS;
  if (bindAddress === undefined || bindAddress.length === 0) {
    throw new Error("eval_recovery_grpc_server requires GRPC_BIND_ADDRESS");
  }

  const store = new PostgresOrchestrationStoreProvider({
    authentication: "static",
    connectionString: databaseUrl,
    migrationsFolder: `${__dirname}/drizzle`,
  });
  await store.migrate();

  const app = await NestFactory.create<NestFastifyApplication>(
    EvalRecoveryModule.register(store),
    new FastifyAdapter(),
  );
  connectRecoveryGrpcTransport(app, {
    bindAddress,
    protoPath: RECOVERY_PROTO_PATH,
  });
  await app.startAllMicroservices();
  app.enableShutdownHooks();
  const httpPort = process.env.HTTP_PORT === undefined ? 0 : Number(process.env.HTTP_PORT);
  await app.listen(httpPort, "127.0.0.1");
}

void bootstrap();
