# Orchestration composition-root split — Phase 1 design

**Status:** proposed; no implementation accompanies this document.  
**Repository baseline:** `main` at `a1f839de0e2fcaa7a071c00bcf675019fd342ace` (Batch 9a / PR #64 merged).  
**Reviewed:** the complete `apps/orchestration-service/src/app.module.ts` (1,074 lines), every provider factory in it, and the constructors/tokens of their local and adapter-backed consumers.

## Decision

Split the composition root, but do **not** pursue a mechanical one-provider-per-module extraction. The safe target is a thin `AppModule` that imports six cohesive feature modules plus one shared composition-infrastructure module:

```text
AppModule
├── OrchestrationInfrastructureModule
├── SecurityModule
├── ArtifactModule
├── ExecutionRuntimeModule
├── WorkflowAuthoringModule
├── IngressModule
└── OperationsModule
```

`ExecutionRuntimeModule` is intentionally the largest module in the first implementation. Its Nodeexec and Recovery factories currently create interleaved, fresh object graphs; splitting those into independent Nest modules without first introducing explicit *factory* tokens would either create a DI cycle or silently alter instance identity. The first extraction must preserve that behavior and make the crossing explicit, not try to eliminate it.

This is therefore a complete, honest partial split: it removes controllers and provider wiring from the root, establishes real exported boundaries, and leaves the intrinsically coupled execution graph together until a later provider-level redesign is authorized.

## Current graph: composition facts

### Shared construction primitives

`app.module.ts` owns these private construction helpers today:

```text
sessionGatewayEnvironment(process.env)
  └─ validates Auth0, actor-token, Redis, DB, AWS/SSM settings
orchestrationStore(env, optional database user)
  └─ PostgresOrchestrationStoreProvider(sharedOrchestrationPoolFactory)
buildRunOutcomeService()
  └─ fresh store → RunOutcomeService
buildRecoveryPolicyService()
  └─ fresh store + model gateway + compiler + planner + Temporal
     + approvals + recovery run reader + Redis blackboard
     + verification reader + capability/selection clients + policy store
     + escalations → RecoveryPolicyService
internalM2mTokenProvider()
  └─ lazy Auth0 M2M provider from the process environment
```

The shared pool factory means stores share a pool implementation, but the code deliberately creates **separate store/provider objects** in most factories. The comments at lines 297–306 and throughout the file make that isolation an explicit current behavior. A module extraction must retain it; replacing all factories with one injected store would be a behavior/lifetime change, not structural work.

### Provider and consumer graph

The table records the real wiring, including token-based adapter controllers. “Fresh” means the factory constructs a new store/client/service instance rather than injecting an existing Nest provider.

| Area | Current provider graph | Real consumers / outward edge |
|---|---|---|
| Security | `APP_GUARD` #1 = `SessionGatewayGuard(M2mValidator, ActorTokenValidator(RedisReplayStore), fresh store)`; #2 `SessionGatewayRateLimitGuard`; #3 `SessionGatewayUploadAllowlistGuard` | Global HTTP guard chain. Order is material. The current root does **not** register `SessionGatewayPromptInjectionGuard`; it only exists in `packages/auth`. |
| Evaluation | `EVAL_FACADE_CONFIG` → `EVAL_FACADE_TOKEN_HASH` and `EvalServiceClient` → `EvalFacadeService` | `EvalFacadeController`; `WorkflowLifecycleService` injects `EvalFacadeService`. |
| Artifacts | fresh store + SSM bucket lookup + S3 → `ArtifactsService`; `ArtifactsService` → `ARTIFACT_CONTENT_HANDLER` / `ArtifactContentGrpcService` | `ArtifactsController`, `ArtifactContentGrpcController`; injected by workflow lifecycle and Nodeexec. |
| Run core | fresh store + Temporal + fresh outcome + fresh provisioning + `DurableRunQueue` → `RunLauncherService`; independent fresh instances of `RunOutcomeService`, `NodeExecutionLedgerService`, `RunStreamEventService`, `RunObservabilityService`; fresh-store `RUNS_HANDLER` / `RunWorkspaceLookupService` | `RunsController`, node-execution/stream/learning/observability controllers; `RunsGrpcController`; `RunLauncherService` is injected by trigger dispatch and project domain. Nodeexec separately constructs outcome/ledger/stream/provisioning dependencies. |
| Human/runtime state | fresh store + Temporal → `ApprovalsService`; fresh store → `EscalationsService`; fresh store + Redis cache → `BLACKBOARD_HANDLER` / `BlackboardGrpcService` | approvals and escalations REST controllers, `BlackboardGrpcController`; separately re-created inside Recovery and Nodeexec graphs. |
| Node execution | async `NODEEXEC_HANDLER` factory: fresh store; Model, Tool, Sandbox, Memory, Verify clients; mock queue adapter; fresh approvals/Temporal; handler registry; ledger; **fresh RecoveryPolicyService**; stream/outcome/provisioning; artifacts; workspace lookup; capability/selection/performance/SSM config; finalization memory writer → `NodeexecService` | `NodeexecGrpcController`. This is the largest cross-domain graph. |
| Recovery | `RECOVERY_HANDLER` → **fresh `buildRecoveryPolicyService()`**. Its dispatch service takes model gateway, graph compiler, planner, approvals, recovery run reader, Temporal node retry signaler, blackboard, verification reader, capability resolver and selection binding. `RecoveryPolicyService` also takes policy store and escalations. | `RecoveryGrpcController`; a second independent policy service is wrapped by `RecoveryTriggerService` inside Nodeexec. |
| Workflow authoring | `CONVERSATION_HANDLER` = fresh store + Model Gateway → `ConversationManagerService`; `COMPILER_HANDLER` = fresh store + capability client → `GraphCompilerService`; fresh-store `WorkflowReadService`, `TemplateVariablesService`, `ClarificationsService`, `ProjectReadService`; `ProjectDomainService` = fresh store + planner + injected conversation handler + injected launcher | conversation/compiler gRPC controllers; workflow/template/clarification/project REST controllers. `ProjectDomainService` creates a clarification loop internally. |
| Workflow lifecycle | injected `ArtifactsService` + injected `EvalFacadeService` + fresh store + SSM + S3 → `WorkflowLifecycleService`; `DEPLOYCTL_HANDLER` aliases it | workflow deployment REST controller and `DeployctlGrpcController`. |
| Trigger ingress | fresh store + Temporal schedule manager → `TriggerRegistryService`; fresh store + Secrets Manager + EventBridge → `TriggerBindingService`; fresh store + injected `RunLauncherService` → `RUNS_DISPATCH_HANDLER` / `TriggerEventDispatchService` | trigger registry, trigger binding, endpoint and integration webhook controllers; `RunDispatchGrpcController`. |
| Webhook ingress | fresh store + WhatsApp config + fresh account registry → `WhatsappWebhookService`; fresh store + Temporal conversation-dispatch client → `ConversationDispatchService` | WhatsApp webhook controller injects both; accounts controller injects registry. |
| Operations | token hash + fresh store → `DeploymentAdminService`; deletion token hash + tenant/system fresh stores → `OrchestrationDeletionService`; static `RegistryService` → `REGISTRY_HANDLER` | deployment admin, deletion and deletion-request controllers; `RegistryGrpcController`. |

### Cross-domain edges that matter

```text
ArtifactsService ───────────────► NodeexecService
        └───────────────────────► WorkflowLifecycleService ◄── EvalFacadeService

RunLauncherService ─────────────► TriggerEventDispatchService
        └────────────────────────► ProjectDomainService

NodeexecService ──(fresh graph)─► RecoveryPolicyService
      │                              ├─ GraphCompilerService-shaped dependency
      │                              ├─ ApprovalsService-shaped dependency
      │                              ├─ BlackboardService
      │                              ├─ capability + selection clients
      │                              └─ EscalationsService
      ├──────────────────────────► RunOutcome/ledger/stream/provisioning
      └──────────────────────────► artifact + sandbox finalization

WhatsAppWebhookController ──────► WhatsappWebhookService
        └────────────────────────► ConversationDispatchService
```

There is no direct Recovery → Nodeexec dependency, so the graph can remain acyclic. The problem is that the Nodeexec factory calls the same private `buildRecoveryPolicyService()` helper as the recovery gRPC factory; the shared construction is invisible to Nest’s module graph and creates two intentionally separate policy-service instances. Recovery also reconstructs compiler, approvals, blackboard and temporal dependencies rather than consuming their root registrations.

## Proposed boundaries

### 1. `OrchestrationInfrastructureModule` — shared composition primitives

Own the environment validation and construction *factories*, not a singleton store:

- `ORCHESTRATION_ENVIRONMENT`
- `ORCHESTRATION_STORE_FACTORY`: `(userOverride?) => PostgresOrchestrationStoreProvider`
- `DURABLE_EXECUTION_FACTORY`: `() => TemporalDurableExecutionProvider`
- `INTERNAL_M2M_TOKEN_PROVIDER_FACTORY`
- reusable SSM/S3/client construction helpers only where their existing factory semantics require them.

It exports these tokens to every feature module. A factory token returns a **new** object per call, preserving the present private-closure and store-object behavior while moving it out of `AppModule`.

### 2. `SecurityModule`

Own the three existing global APP_GUARD registrations in their exact order. It imports infrastructure for environment/store creation and exports nothing. It must not add the unregistered prompt-injection guard as incidental work; that is a separate security-product decision.

### 3. `ArtifactModule`

Own `ArtifactsService`, `ARTIFACT_CONTENT_HANDLER`, `ArtifactsController`, and `ArtifactContentGrpcController`. It imports infrastructure and exports `ArtifactsService` for execution and workflow lifecycle.

### 4. `ExecutionRuntimeModule`

Own Run core, human/runtime state, registry, Nodeexec and Recovery:

- Run launcher, queue, outcome, ledger, stream, observability and run lookup token/controllers.
- Approvals, escalations and blackboard token/controllers.
- Registry token/controller.
- `NODEEXEC_HANDLER` / Nodeexec gRPC controller.
- `RECOVERY_HANDLER` / recovery gRPC controller.

It imports infrastructure and `ArtifactModule`, exports `RunLauncherService` (the only current external service dependency), and exposes internal factory tokens such as `RECOVERY_POLICY_FACTORY`, `RUN_OUTCOME_FACTORY`, and `APPROVALS_FACTORY` only within this module. Those factory tokens make the current fresh-instance requirement explicit without converting private, mutable graphs into accidental application singletons.

The Nodeexec/Recovery portion stays in this module in the first implementation. It is coherent as the run-time execution and repair boundary; separating it further is not safe without a provider-level dependency redesign.

### 5. `WorkflowAuthoringModule`

Own conversation, compiler, workflow read/lifecycle, project domain/read, template variables and clarifications, together with their REST and gRPC controllers. It imports infrastructure, `ArtifactModule`, and `ExecutionRuntimeModule`.

- Export `CONVERSATION_HANDLER` only as required by `ProjectDomainService` inside this module.
- Keep `WorkflowLifecycleService` dependent on exported `ArtifactsService` and `EvalFacadeService` (the latter is supplied by Operations below).
- Import `ExecutionRuntimeModule` for the already-real `RunLauncherService` dependency of project creation.

### 6. `IngressModule`

Own trigger registry/bindings/dispatch plus WhatsApp and conversation-dispatch ingress, their controllers, and gRPC run dispatch controller. It imports infrastructure and `ExecutionRuntimeModule`; the only cross-feature injected service is the already-existing `RunLauncherService` into trigger dispatch.

### 7. `OperationsModule`

Own the eval facade, deployment administration, deletion, and their controllers/tokens. It imports infrastructure and exports `EvalFacadeService` to `WorkflowAuthoringModule`. Registry remains in execution runtime because it is the node execution catalog, not an operational administrative service.

## What deliberately does not split further

1. **Nodeexec and Recovery are one first-pass runtime boundary.** Nodeexec creates its own recovery policy, and recovery in turn creates compiler, approvals, blackboard, Temporal, capability, selection, policy-store and escalation dependencies. Moving those services to separate feature modules while preserving fresh instances needs exported abstract factory tokens and a careful lifetime contract. It is not a mechanical import move.
2. **Run/approval/blackboard registrations stay under execution runtime initially.** Recovery and Nodeexec each create fresh versions of parts of this graph. Splitting them immediately would make it too easy to “simplify” into shared singletons and change state/resource lifetime.
3. **`sessionGatewayEnvironment` must move only with an equivalent factory contract.** It validates production auth and database selection; a global mutable config singleton or a changed startup timing is not an acceptable incidental change.

## Extraction order and validation checkpoints

1. **Infrastructure module.** Move the environment/store/durable/M2M construction logic behind factory tokens; retain current store identity behavior. Validate app boot and the full orchestration-service suite.
2. **Operations module.** Extract Eval facade, admin and deletion. It has no dependency on run-time execution; export only `EvalFacadeService`. Run full suite.
3. **Artifact module.** Extract artifacts and its gRPC/REST surface; export `ArtifactsService`. Recheck async SSM startup behavior and run full suite.
4. **Ingress module.** Extract trigger and webhook composition. Its only material dependency is exported `RunLauncherService`; ensure public integration-webhook handling remains public while global guard ordering stays unchanged. Run full suite.
5. **Workflow authoring module.** Extract conversation/compiler/workflow/project/read composition, importing artifacts, operations and runtime as designed. Run full suite.
6. **Execution runtime module last.** Move the remaining run-time wiring together and replace direct calls to root-private helpers with module-private factory tokens. Run the full suite plus service boot/startup smoke check.
7. **Thin root last.** Make `AppModule` imports-only once every feature module is stable. Run lint, typecheck, build, full test suite, and the architecture-boundary CI script.

Each step is a separately reviewable commit. No service/provider internal logic changes; only Nest module metadata, factory placement, imports and provider-token injection change.

## Concrete risks and mitigations

| Step | Actual risk | Mitigation |
|---|---|---|
| Infrastructure | A singleton store or config token changes connection/resource lifetime; local static DB vs IAM branch changes behavior. | Export factories, not an instance. Preserve `orchestrationStoreConfig`, shared pool factory, and production assertions byte-for-byte where possible. |
| Operations | `WorkflowLifecycleService` loses its `EvalFacadeService` export or token hash becomes invisible to the controller. | Export only the facade class; keep config and hash token module-private with controller in the same module. |
| Artifacts | Async SSM bucket lookup executes before dependencies resolve, or two copies of `ArtifactsService` are registered. | One exported provider only; inject it into lifecycle/nodeexec as today; retain `finally { parameterStore.close(); }`. |
| Ingress | Trigger dispatch cannot see the exported launcher; a global guard becomes module-local by accident; public webhooks are accidentally guarded. | Export `RunLauncherService`; leave `APP_GUARD` only in SecurityModule; preserve `@Public()` controller metadata. |
| Workflow authoring | Imports form a cycle through project → launcher → artifacts/nodeexec or `DEPLOYCTL_HANDLER` no longer aliases the lifecycle singleton. | Runtime may import artifacts, but artifacts must not import runtime; authoring imports both. Keep `useExisting: WorkflowLifecycleService`. |
| Execution runtime | Nest cycle or altered fresh-instance semantics in Nodeexec/Recovery/Approvals; accidentally sharing a `RecoveryPolicyService` changes retry/recovery state. | Keep all three inside one runtime module first. Use explicit factory tokens that manufacture fresh services. Do not inject the controller-facing singleton into Nodeexec or recovery. |
| Final root | Adapter gRPC controllers lose token visibility because a feature module forgot to export a handler token. | Keep each adapter controller in the same feature module as its handler token where possible; integration test all gRPC endpoints during the full suite. |

## Evidence and non-goals

- The real architecture CI check currently enforces the adapter law (no vendor SDK imports directly from app code); it is in `scripts/check-architecture-boundaries.sh`. The new modules must continue to depend on `@alterx/adapters`, not vendor SDKs.
- This design does not change the global guard product posture. In particular, `SessionGatewayPromptInjectionGuard` is present and tested in `packages/auth/session-gateway`, but it is not one of the three APP_GUARD registrations in the current composition root. That discrepancy is recorded here as an observed fact, not folded into an app-module refactor.
- This design does not remove the disclosed mock queue adapter from Nodeexec; that is a provider/adapter concern and out of scope.
- No implementation files have been changed by this Phase 1 work.
