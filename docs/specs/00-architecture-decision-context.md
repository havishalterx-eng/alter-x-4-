ALTER ENGINE — MASTER ARCHITECTURE DECISION CONTEXT

> **RE-TAG NOTE — 2026-08-20, roadmap Phase 1.** This file was previously an
> untracked local doc; added to the repo here so drift like the one below
> can't recur silently. All 7 components section 16 originally listed as
> ADD (greenfield, not yet built) were confirmed in the Full-Engine
> Hardening Review to already exist in code and be wired in the order this
> doc prescribes — see https://claude.ai/code/artifact/88b90e61-95ae-4217-afd0-fb5686892a8a,
> §10 "Architecture conformance". Building from the original ADD list as a
> work order would have meant rebuilding ~1,300 working lines and likely
> breaking the pipeline that already threads them together. Sections 15-16
> below are re-tagged against that evidence: 4 of the 7 move to KEEP (built,
> wired, no defect found against the component itself), 3 move to IMPROVE
> (built, wired, but carrying a real cited defect). Per this doc's own
> `HOW TO READ THIS DOCUMENT` convention elsewhere in the Alter corpus:
> where this file's original text and the audit disagree, the audit
> (REALITY) wins and the disagreement is called out inline, not silently
> edited over.

PURPOSE OF THIS DOCUMENT
This document is the authoritative architectural context for the current version of Alter Engine.
It explains:

* what Alter Engine is supposed to become;
* what the original architecture looked like;
* why LangChain, LangGraph and the wider Lang ecosystem were studied;
* what conclusions were drawn from that comparison;
* why the existing Alter architecture was mostly preserved rather than replaced;
* what components were added;
* what existing components were improved;
* what responsibilities were restructured;
* what should NOT be removed;
* why the current architecture is structured the way it is;
* where Alter's actual moat should live;
* and what order the architecture should now be implemented in.

Do not redesign the architecture casually.
Any architectural change should first explain:

1. What problem exists in the current design.
2. Why the current component cannot solve it.
3. Why a new component is necessary.
4. Whether the responsibility can instead be added to an existing component.
5. What new coupling, latency, security risk or complexity the change introduces.
6. Whether the change strengthens or weakens Alter's intended moat.

1. WHAT ALTER ENGINE IS
Alter Engine is not intended to be simply:

* an AI agent;
* a workflow builder;
* a visual DAG editor;
* an LLM wrapper;
* an n8n competitor;
* a LangGraph clone;
* or a collection of autonomous agents.

The intended product is:
A headless autonomous problem-solving and orchestration engine that takes a business problem or objective, understands it, determines what system should exist to solve it, constructs that system as an executable workflow, runs it, verifies the result, repairs failures, and safely learns from outcomes.
The central flow is:

```text
PROBLEM
   ↓
UNDERSTAND
   ↓
DESIGN THE SYSTEM
   ↓
DISCOVER CAPABILITIES
   ↓
BIND CAPABILITIES
   ↓
COMPILE WORKFLOW
   ↓
EXECUTE DURABLY
   ↓
VERIFY
   ↓
RECOVER / REPLAN IF REQUIRED
   ↓
SYNTHESIZE RESULT
   ↓
LEARN SAFELY

```

The most important sentence in the entire architecture is:
Alter decides what system should exist.
That is the architectural center of gravity.

2. WHERE THIS ARCHITECTURE STARTED
The original Alter Engine architecture was already sophisticated.
It contained major components such as:

```text
Session Gateway
Conversation Manager
ADS Client

Planner
Clarification Loop
Capability Resolver
Selection & Binding Engine
Cache Layer
Graph Compiler
Deployment Controller

Durable Substrate
Node Type Registry
Executor
Blackboard
Provisioning Service

Model Gateway
Tool Gateway
Sandbox Service

Verification & Quality Gate
Recovery Policy Engine

Memory & Learning Service
Policy Store
Drift Detector

Synthesis Service
Cost Ledger

```

It also already contained strong cross-cutting systems:

```text
Eval & Red-team Harness
Type / Schema Contract Plane
Observability Plane
Safety & Policy Plane
Governance & Compliance Plane

```

Therefore, this was never a weak architecture requiring a complete rewrite.
The core already solved many difficult problems:

* task decomposition;
* multi-agent DAG generation;
* parallel execution;
* sequential execution;
* branching;
* merging;
* loops;
* dynamic replanning;
* specialist agent selection;
* agent auto-creation;
* model routing;
* sandbox execution;
* durable workflow execution;
* verification;
* self-healing;
* agent swapping;
* model escalation;
* failure memory;
* controlled learning;
* drift detection;
* versioning;
* evaluation;
* observability;
* safety;
* and governance.

This is important because the final architecture was reached through refinement, not replacement.

3. WHY LANGCHAIN AND LANGGRAPH WERE STUDIED
We specifically investigated the Lang ecosystem because it solves many adjacent problems.
The question was:
If LangChain/LangGraph already support agents, graphs, subgraphs, tools, routing, persistence, multi-agent systems and production execution, then what exactly makes Alter different?
The investigation focused on several areas.

4. FIRST CONCLUSION — LANGGRAPH IS MORE THAN A VISUAL GRAPH
The first misconception we removed was that LangGraph is mainly a graphical representation of an agent.
It is not.
A LangGraph graph is effectively an executable representation of application/agent control flow.
Conceptually:

```text
START
  ↓
NODE
  ↓
DECISION
 ↙     ↘
A       B
 \     /
  MERGE
    ↓
   END

```

Nodes perform work.
Edges determine transitions.
State moves through the graph.
It can contain:

* loops;
* branching;
* subgraphs;
* conditional routing;
* tool execution;
* persistent state;
* human intervention;
* and multi-agent systems.

Therefore:
Having a graph is NOT a moat.
Alter cannot differentiate itself simply by saying:
"We have agent graphs."

5. SECOND CONCLUSION — MULTI-AGENT GRAPHS ALREADY EXIST
LangGraph can support:

```text
MASTER GRAPH
│
├── Research Agent Graph
│
├── Coding Agent Graph
│
├── Finance Agent Graph
│
└── Supervisor

```

An agent itself may effectively contain its own subgraph.
Therefore another possible Alter differentiator disappeared:
"Alter can put multiple agents and workflows inside one workflow."
That is useful, but not unique.
Alter should support it, but it should be considered infrastructure capability, not the primary moat.

6. THIRD CONCLUSION — THE IMPORTANT DIFFERENCE IS WHO DESIGNS THE SYSTEM
This became one of the most important conclusions.
A traditional orchestration framework usually works more like:

```text
DEVELOPER
   ↓
Defines agents
   ↓
Defines tools
   ↓
Defines possible graph structure
   ↓
Defines state
   ↓
Defines transitions
   ↓
Runtime executes

```

Even where runtime routing is dynamic, much of the architectural possibility space was prepared by the developer.
Alter's intended model is different:

```text
USER
"Here is my problem."
        ↓
      ALTER
        ↓
Understand problem
        ↓
Determine necessary capabilities
        ↓
Determine architecture
        ↓
Select/create agents
        ↓
Select tools/APIs/models
        ↓
Generate workflow graph
        ↓
Execute
        ↓
Verify
        ↓
Repair/replan
        ↓
Learn

```

This led to the architectural principle:
Alter should operate one abstraction level above the graph runtime.
Graph execution is necessary.
Graph creation is necessary.
But the important intelligence is:
Determining what graph and agent/tool architecture should exist in the first place.

7. FOURTH CONCLUSION — DO NOT COMPETE ON GRAPH EXECUTION ALONE
LangGraph and other orchestration systems already solve a large amount of:

* state;
* persistence;
* nodes;
* edges;
* retries;
* loops;
* routing;
* subgraphs;
* human-in-the-loop;
* streaming;
* tool calls;
* and agent coordination.

Therefore attempting to beat the market through:
"Our DAG engine is slightly better."
would be a weak strategic position.
The Alter architecture therefore separates:
Intelligence above execution
from
Runtime execution infrastructure.
This is deliberate.

8. WHAT WE LEARNED FROM THE WIDER LANG PRODUCTION STACK
The investigation was expanded beyond LangGraph itself.
We studied the broader architectural ideas around:

* agent construction;
* graph execution;
* persistent threads/state;
* tools;
* MCP;
* middleware;
* triggers;
* deployment;
* tracing;
* evaluation;
* durable workers;
* queues;
* observability;
* and longer-running agent systems.

Several architecture patterns were clearly worth adopting conceptually.
A. Standardize capabilities
Models, APIs, SaaS integrations, MCP servers, databases and tools should not all appear as completely different concepts to the Planner.
They should expose standardized capability metadata.
B. Separate API traffic from execution
Request-serving processes should not also be responsible for executing potentially long-running workflows.
Production execution needs:

```text
Request
   ↓
Run creation
   ↓
Queue
   ↓
Worker
   ↓
Durable execution

```

C. Have controlled boundaries
External systems should not be called randomly by individual agents.
There should be governed gateways.
D. Durable state is essential
Long-running workflows need:

* checkpointing;
* replay;
* retries;
* pause/resume;
* timers;
* crash recovery.

E. Observability cannot be optional
Every execution must be traceable.

9. THEN WE COMPARED THESE FINDINGS AGAINST THE ORIGINAL ALTER ARCHITECTURE
This was the critical step.
We did NOT assume that because Lang had certain ideas, Alter should copy its architecture.
Instead, the existing Foundry architecture was examined component by component.
The result was:
Most of Alter's existing architecture was already correct.
Roughly 80–85% of the conceptual core deserved to remain.
The original architecture already had particularly strong implementations around:

```text
Planner
Capability Resolver
Selection & Binding
Graph Compiler
Durable Substrate
Executor
Verification
Recovery
Memory
Policy Store
Drift

```

Therefore the final decision became:
Preserve Alter's strong existing core and add the missing abstraction layers around it.

10. THE FIVE MAJOR GAPS WE IDENTIFIED
Five important architectural ideas were insufficiently explicit.
These became the major additions.
GAP 1 — PROBLEM UNDERSTANDING
Previously:

```text
Conversation
   ↓
ADS
   ↓
Planner

```

Problem:
The Planner could receive something too close to raw conversational context.
That creates ambiguity between:

* what the user said;
* what the user actually wants;
* the current business state;
* constraints;
* actors;
* systems;
* risk;
* and success criteria.

Therefore we added:
Problem Understanding
New flow:

```text
Conversation
   ↓
ADS Context
   ↓
PROBLEM UNDERSTANDING
   ↓
Typed ProblemSpec
   ↓
Planner

```

The ProblemSpec should describe:

```text
objective
current situation
actors
systems involved
constraints
required data
risk
missing information
success criteria

```

Why:
The Planner should plan from a structured problem, not raw chat.

GAP 2 — ARCHITECTURE SYNTHESIZER
This became the single most important addition.
Previously the flow was approximately:

```text
Planner
 ↓
Capability Resolver
 ↓
Selection & Binding
 ↓
Graph Compiler

```

The problem was:
Who decides the actual system topology?
For example:
Should this problem use:

* one agent;
* three specialist agents;
* a manager-worker system;
* deterministic code;
* an API call;
* a subgraph;
* parallel workers;
* a human approval step;
* a loop;
* a conditional branch;
* or some combination?

The Graph Compiler should NOT invent all of this.
Its responsibility should be compilation.
Therefore:

```text
Planner
 ↓
Capability Resolver
 ↓
ARCHITECTURE SYNTHESIZER
 ↓
Selection / Binding
 ↓
Graph Compiler

```

The Architecture Synthesizer produces an ArchitectureSpec.
Conceptually:

```text
ArchitectureSpec
{
    topology
    agent roles
    deterministic nodes
    required tools
    required data
    subgraphs
    branches
    loops
    human gates
    parallelism
    communication structure
    termination conditions
}

```

Why:
This is the layer where Alter decides what system should exist.
This layer is a major candidate for Alter's moat.

GAP 3 — CAPABILITY REGISTRY
We already had:

```text
Capability Resolver
Selection & Binding

```

But that raised a fundamental question:
What are these components actually searching?
Therefore we introduced a unified:
Capability Registry
It should know about:

```text
Agents
Models
Tools
Functions
MCP servers
REST APIs
SaaS connectors
Databases
Data sources
RAG systems
Templates
Workflow patterns
Reusable subgraphs
Existing proven workflows

```

Every capability should expose useful metadata such as:

```text
schema
permissions
tenant availability
authentication requirements
cost
latency
quality
historical reliability
supported actions
risk
compatibility
current availability

```

Then:

```text
Architecture Synthesizer
        ↓
Capability Registry
        ↓
Selection & Binding

```

Why:
Alter needs one searchable source of truth for everything it is capable of using.

GAP 4 — EVENT & TRIGGER GATEWAY
Alter should not require a human to type:
"Run my workflow."
Work can begin from:

```text
Chat
API
Webhook
Cron
Email
CRM event
Database event
File event
Pub/Sub
External application
Business system

```

Therefore all trigger sources should enter through:
Event & Trigger Gateway
Its job is normalization.
Different external signals become a standard Alter event carrying information such as:

```text
tenant
source
authentication context
event type
payload
timestamp
idempotency information
workflow reference

```

Why:
Alter should be event-native, not chat-dependent.

GAP 5 — RUN MANAGER + QUEUE + WORKERS
The original Durable Substrate was good.
It already provided ideas such as:

* persistence;
* replay;
* retries;
* pause/resume;
* crash recovery.

But production-scale execution needed a more explicit boundary.
Therefore:

```text
Graph
 ↓
Run Manager
 ↓
Durable Run Queue
 ↓
Execution Workers
 ↓
Durable Substrate
 ↓
Executor

```

Run Manager
Owns:

```text
run identity
run state
deadlines
cancellation
scheduling
dispatch
lifecycle

```

Durable Run Queue
Provides:

```text
backpressure
priority
leases
retry scheduling
durability

```

Execution Workers
Provide:

```text
horizontal scaling
concurrency
job claiming
worker isolation
execution capacity

```

Why:
Thousands of workflows should scale through worker infrastructure, not through one dedicated engine instance per user.

11. RESPONSIBILITIES WE DECIDED TO RESTRUCTURE
Not everything missing required a new component.
Some existing components simply owned too much or sat in the wrong place.
RESTRUCTURE 1 — SANDBOX SERVICE
Previously the Sandbox included things such as:

```text
code execution
files
packages
browser
search
database operations
general tools

```

This mixes very different security boundaries.
Final responsibility:
Sandbox = isolated computation
It should own:

```text
code execution
file operations
package installation
build
lint
test
render
isolated runtime
artifact generation

```

It should NOT own general business integrations.
Those move behind:
Tool Gateway
which owns:

```text
REST
MCP
SaaS connectors
browser tools
database tools
search
external actions
OAuth
credentials
permissions
rate limits
audit

```

Why:
Code execution and external business actions have different security models and blast radii.

RESTRUCTURE 2 — DEPLOYMENT CONTROLLER
Originally the architecture had:

```text
Graph Compiler
   ↓
Deployment Controller
   ↓
Execution

```

This implied every execution goes through a deployment process.
That is not correct.
Temporary/ad-hoc workflows may execute without being "deployed."
Deployment is actually part of workflow lifecycle management.
Therefore the Deployment Controller becomes:
Workflow Lifecycle
It manages:

```text
Draft
 ↓
Test
 ↓
Evaluation
 ↓
Publish
 ↓
Canary
 ↓
Production
 ↓
Rollback

```

Why:
Deployment is a lifecycle concern, not a mandatory request-stage component.

RESTRUCTURE 3 — CACHE
The original architecture placed Cache inside the planning path.
That is conceptually wrong.
Caching is an optimization concern.
Therefore Cache / Reuse becomes a cross-cutting layer affecting:

```text
Planning
Models
Retrieval
Tools
Subgraphs
Results

```

where safe.
Why:
Cache should accelerate intelligence and execution; it should not determine the architecture pipeline.

12. FINAL ALTER ENGINE ARCHITECTURE
The final merged architecture contains eight primary layers.
LAYER 1 — FRONT DOOR

```text
Event & Trigger Gateway
Session / Tenant Gateway
Conversation Manager

```

Purpose:
Accept work, identify ownership, establish permission context and understand interaction intent.
LAYER 2 — CONTEXT

```text
ADS Client
Problem Understanding

```

Purpose:
Load correct business context and convert the request into a defined problem.
LAYER 3 — ALTER BRAIN

```text
Planner
Clarification Loop
Capability Resolver
Architecture Synthesizer

```

Purpose:
Decide how the problem should be solved.
This is the most strategically important layer.
LAYER 4 — CAPABILITY FABRIC

```text
Capability Registry
Selection & Binding

```

Registry may contain:

```text
Agents
Tools
Models
MCP
APIs
Connectors
Subgraphs
RAG
Data sources
Templates

```

Purpose:
Convert abstract requirements into actual usable capabilities.
LAYER 5 — GRAPH BUILD

```text
Graph Compiler
Workflow Lifecycle

```

Purpose:
Convert ArchitectureSpec into an executable typed/versioned WorkflowDAG and manage its lifecycle.
LAYER 6 — DURABLE RUNTIME

```text
Run Manager
Durable Run Queue
Execution Workers
Durable Substrate
Node Type Registry
Executor
Blackboard
Provisioning

```

Purpose:
Execute workflows reliably and at scale.
LAYER 7 — EXECUTION GATEWAYS

```text
Model Gateway
Tool Gateway
Sandbox Service

```

Purpose:
Ensure models, tools and code execution can only be accessed through controlled boundaries.
LAYER 8 — VERIFY, HEAL & LEARN

```text
Verification & Quality Gate
Recovery Policy Engine
Synthesis
Memory & Learning
Policy Store
Drift Detector

```

Purpose:
Determine whether the workflow actually succeeded, repair failures at the appropriate layer, return the final output and safely improve future behavior.

13. COMPLETE FLOW

```text
CHAT / API / EVENT / WEBHOOK / CRON
                 │
                 ▼
       EVENT & TRIGGER GATEWAY
                 │
                 ▼
       SESSION / TENANT GATEWAY
                 │
                 ▼
        CONVERSATION MANAGER
                 │
                 ▼
             ADS CLIENT
                 │
                 ▼
       PROBLEM UNDERSTANDING
                 │
                 ▼
              PLANNER
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 │
 CLARIFICATION            │
        │                 │
        └──────→ PLANNER ─┘
                 │
                 ▼
        CAPABILITY RESOLVER
                 │
                 ▼
      ARCHITECTURE SYNTHESIZER
                 │
                 ▼
         CAPABILITY REGISTRY
                 │
                 ▼
        SELECTION & BINDING
                 │
                 ▼
           GRAPH COMPILER
                 │
                 ▼
        VERSIONED WORKFLOW
                 │
                 ▼
             RUN MANAGER
                 │
                 ▼
         DURABLE RUN QUEUE
                 │
                 ▼
        EXECUTION WORKERS
                 │
                 ▼
         DURABLE SUBSTRATE
                 │
                 ▼
              EXECUTOR
        ┌────────┼────────┐
        │        │        │
        ▼        ▼        ▼
     MODEL     TOOL    SANDBOX
    GATEWAY   GATEWAY
        │        │        │
        └────────┼────────┘
                 │
                 ▼
       VERIFICATION & QUALITY
                 │
         ┌───────┴───────┐
         │               │
        PASS            FAILURE
         │               │
         ▼               ▼
     SYNTHESIS      RECOVERY ENGINE
                         │
             ┌───────────┼────────────┐
             │           │            │
           RETRY       REBIND      RECOMPILE
             │           │            │
             │        REPLAN       CLARIFY
             │           │            │
             └───────────┴────────────┘
                         │
                         ▼
                    EXECUTE AGAIN

FINAL VERIFIED RESULT
        │
        ▼
 MEMORY & LEARNING
        │
        ▼
    POLICY STORE
        │
        ├────────→ Selection & Binding
        ├────────→ Recovery
        └────────→ Architecture preferences

DRIFT DETECTOR
        │
        └────────→ Policy maintenance

```

14. CROSS-CUTTING PLANES
These do not belong to one pipeline stage.
They apply across Alter.
Tenant Isolation — IMPROVE
Must guarantee:

```text
tenant isolation
workspace isolation
project isolation
credential isolation
memory isolation
run isolation
artifact isolation
tool permission isolation

```

Tenant identity must follow every run and every downstream request.
Safety & Policy — KEEP
Own:

```text
prompt injection protection
unsafe action policy
SSRF protection
PII controls
risk classifications
action restrictions

```

Type / Schema Contracts — KEEP
Every important handoff should use typed objects.
Examples:

```text
ProblemSpec
CapabilityRequirement
ArchitectureSpec
WorkflowDAG
RunSpec
NodeInput
NodeOutput
VerificationResult
RecoveryDecision
LearningRecord

```

Avoid passing critical control state through unstructured natural-language strings.
Observability — KEEP
Everything should be traceable:

```text
run
workflow
node
agent
model
tool
retry
recovery
cost
latency
decision
approval

```

Eval & Red-Team — KEEP
Changes to:

```text
planner
policies
agents
models
node types
architecture generation
recovery

```

must be evaluable before production promotion.
Governance & Compliance — KEEP
Own:

```text
data residency
retention
deletion
audit
regional restrictions
compliance policy

```

Cost & FinOps — KEEP
Track:

```text
tenant
workflow
run
node
model
tool
sandbox
storage

```

Cost information should influence routing where appropriate.
Cache / Reuse — RESTRUCTURE
Cross-cutting optimization.
Never allow caching to violate:

```text
tenant boundaries
permissions
freshness
security
workflow correctness

```

15. COMPONENT DECISIONS
The current decision map is:
[RE-TAGGED 2026-08-20 -- see note at top of file. Originally KEEP 13 / ADD 7
/ IMPROVE 8. Now KEEP 17 / ADD 0 / IMPROVE 11, reflecting that every
former-ADD component already exists in the tree.]
KEEP — 17 components
Conversation Manager — P0
Keep focused on conversational intent and active-goal state.
Do NOT let it become the Planner.
ADS Client — P0
Keep as the scoped path to long-term tenant/project context.
Planner — P0
Keep as primary decomposition and full-replan authority.
Clarification Loop — P1
Keep, but ask questions only when uncertainty materially blocks safe/useful execution.
Durable Substrate — P0
Keep durability, replay, retry, timers, pause/resume and crash recovery.
Node Type Registry — P1
Keep pluggable execution contracts.
Executor — P0
Keep deterministic graph execution around AI nodes.
Blackboard — P1
Keep typed per-run shared context.
Do not turn it into unlimited long-term memory.
Provisioning — P1
Keep on-demand runtime preparation and dependency injection.
Model Gateway — P0
Keep as the only direct provider boundary.
Verification & Quality Gate — P0
Keep independent validation before declaring success.
Synthesis — P1
Keep final verified result assembly.
Drift Detector — P2
Keep ongoing evaluation of learned routing/policies.
Event & Trigger Gateway — P1 [was ADD; moved 2026-08-20]
Already built: trigger-registry/, trigger-bindings/, webhooks/, canonical-
event consumer. Audit rated the webhook/ingress path clean (HMAC +
timingSafeEqual + replay rejection, verified line-by-line). Keep as-is;
the money-carrying consumer downstream of it is a separate component --
see Execution Workers under IMPROVE.
Problem Understanding — P0 [was ADD; moved 2026-08-20]
Already built: intelligence-service/src/problem_understanding/, 421 LOC.
Not independently line-by-line verified in the hardening audit (outside
its scanned depth) -- no defect found, but also not confirmed clean.
Keep; a future pass should read it, not rebuild it.
Architecture Synthesizer — P0 [was ADD; moved 2026-08-20]
Already built: architecture_synthesizer/, 506 LOC, confirmed wired in the
prescribed order (imports Planner -> Capability Resolver -> Capability
Registry -> Selection & Binding, producing ArchitectureSpec). No defect
found against this component itself.
Capability Registry — P0 [was ADD; moved 2026-08-20]
Already built: capability_registry/, 350 LOC, plus
packages/shared-clients/src/capability-registry.ts. No defect found.

16. ADD — 0 components
Originally 7 (Event & Trigger Gateway, Problem Understanding, Architecture
Synthesizer, Capability Registry, Run Manager, Durable Run Queue,
Execution Workers). All 7 confirmed already built and wired as of the
2026-08-20 hardening audit -- see the re-tag note at the top of this file.
4 moved to KEEP above; 3 moved to IMPROVE below, since each carries a real
cited defect on top of already existing. There is currently no genuinely
unbuilt ADD-tier component in this architecture.

17. IMPROVE — 11 components
Run Manager — P1 [was ADD; moved 2026-08-20]
Built as RunLauncherService, but carries two Critical findings from the
hardening audit: (1) dispatchNextQueuedRun has no scheduler/cron/interval
anywhere in orchestration-service -- draining only happens as a side
effect of the next launch, so a run can stall in `pending` forever;
(2) the dispatch catch block acknowledges (deletes) the queue entry on
ANY error from `getRun`, not just the terminal-failure case its own
comment describes, so one transient DB error permanently drops a run.
Fix: add a background sweeper/scheduler; narrow the catch to the real
terminal-failure type.
Durable Run Queue — P1 [was ADD; moved 2026-08-20]
Built as DurableRunQueue -- leasing via FOR UPDATE SKIP LOCKED, lease
tokens, idempotent enqueue, priority ordering are all real and audit-
verified sound in isolation. High finding: `attempts` is incremented on
every claim and read by nobody, so a run that fails deterministically at
startup retries forever with no cap and no dead-letter path.
Fix: threshold on claimed.attempt in dispatchNextQueuedRun; past the cap,
transition to `failed` and discard() the entry.
Execution Workers — P1 [was ADD; moved 2026-08-20]
Built as background-workers + the Temporal executor worker. High finding:
the cost-event consumer (the money-carrying queue consumer in this app)
runs against a QueueProvider.consume() that deletes on receipt before
processing, with three defects -- malformed events vanish silently
(already dequeued, never requeued/DLQ'd/logged), the republish path has
no attempt counter so a consistently-failing event loops forever, and a
crash between consume() and publish() loses the message permanently. The
canonical-event consumer one directory over does this correctly (stays
in-flight, redelivers on visibility timeout, deletes only when terminal)
-- fix is to move the cost consumer onto that same port.
Session / Tenant Gateway — P0
Strengthen:

```text
tenant isolation
RBAC
credential scope
run identity
policy propagation

```

Capability Resolver — P0
Make it:

```text
registry-backed
capability-first
provider-independent

```

It determines what is required, not which provider is used.
Selection & Binding — P0
Routing should consider more than vector similarity.
Use:

```text
quality
latency
cost
permissions
historical reliability
availability
policy
risk
learned performance

```

Graph Compiler — P0
The compiler should compile ArchitectureSpec → WorkflowDAG.
It should not independently invent the architecture.
Tool Gateway — P1
Expand to governed support for:

```text
REST
MCP
SaaS
browser
database
search
OAuth
credentials
permissions
audit

```

Recovery Policy Engine — P0
Make recovery explicitly multi-layer.
Possible actions:

```text
retry
backoff
repair
switch model
replace agent
rebind tool
recompile branch
full replan
ask user
degrade partially
terminate

```

Memory & Learning — P1
Only write learning that is:

```text
verified
scoped
versioned
reversible
provenanced
confidence-scored

```

Policy Store — P1
Extend learning targets to:

```text
routing weights
quality thresholds
recovery preferences
architecture pattern scores
agent performance
model performance

```

18. RESTRUCTURE — 2 CORE COMPONENTS + CACHE PLANE
Workflow Lifecycle — P2
Formerly Deployment Controller.
Move away from mandatory execution path.
Sandbox — P1
Keep isolated computation only.
Move general external tools to Tool Gateway.
Cache / Reuse Plane — P2
Move outside planning pipeline and make cross-cutting.

19. REMOVE — ZERO CORE COMPONENTS
No core Alter component is currently recommended for deletion.
We remove responsibility duplication, not useful capability.
Specifically:
Remove from Sandbox

```text
search ownership
browser ownership
database ownership
business API ownership

```

Those belong behind Tool Gateway.
Remove Deployment from mandatory request flow
Deployment becomes workflow lifecycle management.
Remove Cache as a planning step
Cache becomes cross-cutting infrastructure.

20. BUILD PRIORITIES
P0 — PROTECT THE CORE + FINISH THE ALTER BRAIN
Highest priority.
Focus on:

```text
Tenant isolation
Problem Understanding
Planner
Capability Resolver
Architecture Synthesizer
Capability Registry
Selection & Binding
Graph Compiler
Durable execution
Verification
Recovery
Model Gateway

```

Why:
If Alter cannot consistently turn problems into correct architectures, everything else is secondary.
P0 proves Alter's fundamental thesis.
P1 — MAKE ALTER SCALABLE AND CONNECTED
Then build:

```text
Event & Trigger Gateway
Run Manager
Durable Queue
Execution Workers
Tool Gateway expansion
MCP
connectors
Sandbox boundary
Blackboard hardening
Provisioning
Memory hardening
Policy Store
Synthesis

```

Why:
Once Alter can think correctly, it needs to operate reliably inside real businesses.
P2 — OPERATIONAL MATURITY
Then strengthen:

```text
Workflow Lifecycle
Canary deployment
Rollback
Drift detection
Cache/reuse
Cost optimization
deeper eval coverage
production tuning

```

Why:
These capabilities become increasingly important after the core intelligence and execution loop are proven.

21. ALTER'S INTENDED MOAT
Do NOT describe the moat as:
"Alter uses graphs."
Weak.
Do NOT describe it as:
"Alter uses multiple AI agents."
Weak.
Do NOT describe it as:
"Alter connects APIs."
Weak.
Do NOT describe it as:
"Alter self-heals."
Self-healing is important, but alone it is insufficient.
The intended moat is the combination of three systems.
MOAT 1 — AUTONOMOUS SYSTEM DESIGN

```text
Problem
 ↓
ProblemSpec
 ↓
Capabilities required
 ↓
ArchitectureSpec
 ↓
WorkflowDAG

```

Alter decides what architecture should exist.
Over time, Alter should become increasingly good at selecting architectures for specific problem classes.
MOAT 2 — MULTI-LAYER RECOVERY
Most simple systems treat failure as:

```text
failure → retry

```

Alter should determine which layer failed.
Examples:

```text
provider failed → switch provider

agent failed → replace agent

tool failed → rebind capability

node failed → repair node

branch design failed → recompile branch

workflow assumption failed → replan

problem misunderstood → clarify/re-understand

safe completion impossible → degrade/terminate

```

This is much more powerful than retry logic.
MOAT 3 — CONTROLLED LEARNING
Alter should improve from execution history without uncontrolled self-modification.
Learning should affect:

```text
architecture patterns
routing
agent selection
model selection
recovery preference
quality thresholds
cost/latency trade-offs

```

through versioned policies.
Not random production code rewriting.
The long-term flywheel becomes:

```text
More workflows
      ↓
More verified outcomes
      ↓
Better architecture knowledge
      ↓
Better capability selection
      ↓
Better recovery knowledge
      ↓
Higher reliability
      ↓
More workflows

```

That is potentially far more defensible than simply owning a workflow editor.

22. WHY THE ARCHITECTURE HAS BOTH AI AND DETERMINISTIC SYSTEMS
Alter should NOT make every component an LLM agent.
Use AI where judgment is valuable:

```text
Problem Understanding
Planning
Clarification
Capability reasoning
Architecture Synthesis
Verification reasoning
Recovery diagnosis
Synthesis
Learning interpretation

```

Use deterministic systems where correctness matters:

```text
authentication
authorization
tenant isolation
queues
schema validation
workflow state
run state
cost accounting
credential handling
rate limiting
audit
workflow persistence
node scheduling
versioning
policy enforcement

```

Principle:
AI decides where judgment is required. Deterministic infrastructure enforces execution and safety.

23. WHY ADS REMAINS SEPARATE
ADS remains Alter's long-term business context source.
Alter should access ADS through a scoped ADS Client.
Do not allow every component to freely query long-term tenant data.
Conceptually:

```text
Tenant
 ↓
Project / Workspace
 ↓
ADS boundary
 ↓
Scoped retrieval
 ↓
Alter

```

Alter must distinguish:

```text
current problem state
vs.
historical context

```

Long-term memory and active run state are not the same concept.

24. USER/TENANT ISOLATION PRINCIPLE
Alter is multi-tenant.
User A must never share:

```text
memory
credentials
files
workflow state
context
artifacts
vectors
logs
tool permissions
run data

```

with User B unless explicit organizational permission permits it.
Every major object should carry an ownership scope similar to:

```text
tenant_id
workspace_id
project_id
user_id
run_id

```

as appropriate.
Isolation must be enforced architecturally, not merely through prompting.

25. THE FINAL PRODUCT PHILOSOPHY
Alter should feel simple to the user even though the backend is complex.
The user experience should conceptually be:

```text
USER:
"Here is the problem."

ALTER:
"I understand."

ALTER internally:
→ retrieve context
→ define problem
→ design architecture
→ discover capabilities
→ bind agents/tools
→ compile workflow
→ execute
→ verify
→ recover if necessary
→ synthesize
→ learn

```

The complexity belongs inside the engine.
The user should not be required to manually become a workflow engineer.
That is one of the central product principles.

26. ARCHITECTURAL RULES GOING FORWARD
Any future development should respect these rules.
Rule 1
Do not add components merely because another AI framework has them.
Rule 2
Do not turn Alter into a LangGraph wrapper.
Rule 3
Do not compete primarily on DAG execution.
Rule 4
Keep intelligence and deterministic infrastructure separated.
Rule 5
Architecture Synthesizer owns system topology decisions.
Rule 6
Graph Compiler compiles architecture; it does not own high-level architecture reasoning.
Rule 7
Capability Resolver determines requirements.
Rule 8
Capability Registry describes what exists.
Rule 9
Selection & Binding chooses concrete implementations.
These are three separate concepts.
Rule 10
All external actions pass through controlled gateways.
Rule 11
Sandbox is for isolated computation, not every type of tool.
Rule 12
Durable execution should be infrastructure-backed, not custom retry spaghetti.
Rule 13
Verification must happen before learning.
Rule 14
Learning updates controlled policies rather than autonomously rewriting production code.
Rule 15
Recovery should repair the smallest failed layer possible.
Rule 16
Tenant scope propagates through the entire execution lifecycle.
Rule 17
Every major control-flow object should be typed and versioned.
Rule 18
Observability is part of architecture, not an afterthought.

27. THE CORE RESEARCH QUESTION FROM THIS POINT FORWARD
The most important research question is no longer:
"How do we execute a graph?"
That problem is comparatively understood.
The important question is:
Given a business problem, context, available capabilities, constraints, historical performance and policies, how can Alter reliably determine the best executable system architecture?
That means future R&D should deeply investigate:

```text
ProblemSpec generation
task decomposition
architecture search
agent topology selection
capability matching
subgraph selection
workflow pattern retrieval
architecture scoring
architecture simulation
risk estimation
cost estimation
latency estimation
quality prediction
architecture verification
architecture learning

```

This is where a major portion of the proprietary intelligence should eventually live.

28. HOW TO USE THIS CONTEXT
When working on Alter Engine:

1. Treat this architecture as the current baseline.
2. Preserve existing component boundaries unless there is a strong reason to alter them.
3. Prioritize P0 before adding broad peripheral functionality.
4. Evaluate every new feature according to which existing component owns it.
5. Create a new component only when no existing ownership boundary makes architectural sense.
6. Keep Alter provider-independent wherever practical.
7. Do not confuse a model provider, tool provider or orchestration primitive with Alter's own product intelligence.
8. Optimize Alter around the complete lifecycle:

```text
UNDERSTAND
→ DESIGN
→ BUILD
→ EXECUTE
→ VERIFY
→ RECOVER
→ LEARN

```

FINAL ARCHITECTURAL THESIS
The reasoning journey started with:
"Can Alter build multi-agent workflows?"
That was not enough.
Then:
"Can Alter dynamically execute graphs?"
Still not enough.
Then:
"Can Alter generate graphs?"
Better, but still incomplete.
The final architectural thesis became:
Alter Engine should understand a problem, decide what system should exist to solve it, discover and bind the required capabilities, compile that system into a durable executable workflow, verify its real-world outcome, repair failures at the appropriate architectural layer, and safely learn which architectures work best over time.
That is the reason the current Alter Engine architecture exists in its present form.
The moat is not the graph.
The moat is the intelligence around the entire lifecycle of the graph.
