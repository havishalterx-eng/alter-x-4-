import { beforeEach, describe, expect, it } from "vitest"

import { useRunStreamStore } from "./useRunStreamStore"
import type {
  ArtifactCreatedEvent,
  HumanActionEvent,
  ModelDeltaEvent,
  NodeStatusEvent,
  ProjectFileEvent,
  RunEvent,
  RunStatusEvent,
  TerminalEvent,
  TestEvent,
} from "@/api/types"

const RUN_ID = "run_01JAX48P"

function base(sequence: number) {
  return { id: `evt_${sequence}`, runId: RUN_ID, sequence, timestamp: "2026-01-01T00:00:00.000Z" }
}

function runStatusEvent(
  overrides: Partial<RunStatusEvent> & { sequence: number; type: RunStatusEvent["type"] },
): RunStatusEvent {
  return { ...base(overrides.sequence), status: "running", ...overrides }
}

function nodeEvent(
  overrides: Partial<NodeStatusEvent> & { sequence: number; type: NodeStatusEvent["type"]; nodeId: string },
): NodeStatusEvent {
  return { ...base(overrides.sequence), status: "running", attempt: 1, ...overrides }
}

function modelDeltaEvent(overrides: Partial<ModelDeltaEvent> & { sequence: number; nodeId: string }): ModelDeltaEvent {
  return { ...base(overrides.sequence), type: "model.delta", delta: "", ...overrides }
}

function terminalEvent(
  overrides: Partial<TerminalEvent> & { sequence: number; type: TerminalEvent["type"] },
): TerminalEvent {
  return { ...base(overrides.sequence), content: "", ...overrides }
}

function artifactEvent(overrides: Partial<ArtifactCreatedEvent> & { sequence: number }): ArtifactCreatedEvent {
  return { ...base(overrides.sequence), type: "artifact.created", artifactId: "art_1", ...overrides }
}

function projectFileEvent(overrides: Partial<ProjectFileEvent> & { sequence: number }): ProjectFileEvent {
  return { ...base(overrides.sequence), type: "project.file.changed", fileId: "file_1", status: "created", ...overrides }
}

function testEvent(overrides: Partial<TestEvent> & { sequence: number; type: TestEvent["type"] }): TestEvent {
  return { ...base(overrides.sequence), ...overrides }
}

function humanActionEvent(
  overrides: Partial<HumanActionEvent> & { sequence: number; type: HumanActionEvent["type"] },
): HumanActionEvent {
  return { ...base(overrides.sequence), actionId: "ha_1", ...overrides }
}

beforeEach(() => {
  useRunStreamStore.getState().clear()
})

describe("useRunStreamStore.applyEvent -- sequence dedup", () => {
  it("no-ops an event whose sequence is <= the store's lastSequence", () => {
    const { applyEvent } = useRunStreamStore.getState()

    applyEvent(runStatusEvent({ sequence: 5, type: "run.started", status: "running" }))
    expect(useRunStreamStore.getState().lastSequence).toBe(5)
    expect(useRunStreamStore.getState().events).toHaveLength(1)

    // Equal sequence: rejected.
    applyEvent(runStatusEvent({ sequence: 5, type: "run.failed", status: "failed" }))
    expect(useRunStreamStore.getState().lastSequence).toBe(5)
    expect(useRunStreamStore.getState().events).toHaveLength(1)
    expect(useRunStreamStore.getState().runStatus).toBe("running")

    // Lower sequence: rejected.
    applyEvent(runStatusEvent({ sequence: 3, type: "run.failed", status: "failed" }))
    expect(useRunStreamStore.getState().lastSequence).toBe(5)
    expect(useRunStreamStore.getState().events).toHaveLength(1)
    expect(useRunStreamStore.getState().runStatus).toBe("running")
  })
})

describe("useRunStreamStore.applyEvent -- run.status/started/completed/failed", () => {
  it.each([
    ["run.status", "running", "waiting", "waiting"],
    ["run.started", "running", "waiting", "waiting"],
    ["run.completed", "completed", "cancelled", "cancelled"],
    ["run.failed", "failed", "degraded", "degraded"],
  ] as const)("%s with a real status uses that status (%s -> %s -> %s)", (type, _defaultFallback, status, expected) => {
    useRunStreamStore.getState().applyEvent(runStatusEvent({ sequence: 1, type, status }))
    expect(useRunStreamStore.getState().runStatus).toBe(expected)
  })

  it.each([
    ["run.status", "running"],
    ["run.started", "running"],
    ["run.completed", "completed"],
    ["run.failed", "failed"],
  ] as const)("falls back correctly when %s arrives with a falsy status (-> %s)", (type, expected) => {
    // Real SSE payloads aren't guaranteed to match the RunStatusEvent type at
    // runtime -- this deliberately constructs a malformed event to exercise
    // applyEvent's own `e.status || ...` fallback branch.
    const malformed = { ...runStatusEvent({ sequence: 1, type, status: "running" }), status: undefined } as unknown as RunStatusEvent
    useRunStreamStore.getState().applyEvent(malformed)
    expect(useRunStreamStore.getState().runStatus).toBe(expected)
  })
})

describe("useRunStreamStore.applyEvent -- node.* events", () => {
  it("creates a new nodeExecutions entry with the exact default shape", () => {
    useRunStreamStore.getState().applyEvent(
      nodeEvent({
        sequence: 1,
        type: "node.started",
        nodeId: "n1",
        status: "running",
        attempt: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    )

    expect(useRunStreamStore.getState().nodeExecutions.n1).toEqual({
      id: "exec_n1",
      runId: RUN_ID,
      nodeId: "n1",
      nodeName: "n1",
      nodeType: "unknown",
      status: "running",
      attempt: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
    })
  })

  it("leaves startedAt undefined on the default shape for a non-started event", () => {
    useRunStreamStore.getState().applyEvent(
      nodeEvent({ sequence: 1, type: "node.waiting", nodeId: "n1", status: "waiting", attempt: 1 }),
    )
    expect(useRunStreamStore.getState().nodeExecutions.n1.startedAt).toBeUndefined()
  })

  it("updates an existing nodeExecutions entry in place rather than replacing its identity fields", () => {
    const store = useRunStreamStore.getState()
    store.applyEvent(
      nodeEvent({ sequence: 1, type: "node.started", nodeId: "n1", status: "running", attempt: 1, timestamp: "T0" }),
    )
    store.applyEvent(
      nodeEvent({ sequence: 2, type: "node.retrying", nodeId: "n1", status: "waiting", attempt: 2, timestamp: "T1" }),
    )

    const ex = useRunStreamStore.getState().nodeExecutions.n1
    expect(ex.id).toBe("exec_n1")
    expect(ex.nodeId).toBe("n1")
    expect(ex.status).toBe("waiting")
    expect(ex.attempt).toBe(2)
    // startedAt is only ever set on node.started's default-shape construction
    // -- a later, non-started event must not overwrite it.
    expect(ex.startedAt).toBe("T0")
  })

  it.each(["node.completed", "node.failed"] as const)(
    "%s computes durationMs from a prior node.started's timestamp to its own",
    (type) => {
      const store = useRunStreamStore.getState()
      store.applyEvent(
        nodeEvent({
          sequence: 1,
          type: "node.started",
          nodeId: "n1",
          status: "running",
          attempt: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      )
      store.applyEvent(
        nodeEvent({
          sequence: 2,
          type,
          nodeId: "n1",
          status: type === "node.completed" ? "completed" : "failed",
          attempt: 1,
          timestamp: "2026-01-01T00:00:05.500Z",
        }),
      )

      const ex = useRunStreamStore.getState().nodeExecutions.n1
      expect(ex.completedAt).toBe("2026-01-01T00:00:05.500Z")
      expect(ex.durationMs).toBe(5_500)
    },
  )

  it("leaves durationMs unset (not NaN) when node.completed arrives without a prior node.started", () => {
    useRunStreamStore.getState().applyEvent(
      nodeEvent({
        sequence: 1,
        type: "node.completed",
        nodeId: "n1",
        status: "completed",
        attempt: 1,
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
    )

    const ex = useRunStreamStore.getState().nodeExecutions.n1
    expect(ex.startedAt).toBeUndefined()
    expect(ex.completedAt).toBe("2026-01-01T00:00:05.000Z")
    expect(ex.durationMs).toBeUndefined()
    expect(Number.isNaN(ex.durationMs)).toBe(false)
  })
})

describe("useRunStreamStore.applyEvent -- model.delta", () => {
  it("accumulates delta tokens into nodeExecutions[nodeId].metadata.modelOutput", () => {
    const store = useRunStreamStore.getState()
    store.applyEvent(
      nodeEvent({ sequence: 1, type: "node.started", nodeId: "n1", status: "running", attempt: 1, timestamp: "T0" }),
    )
    store.applyEvent(modelDeltaEvent({ sequence: 2, nodeId: "n1", delta: "Hello" }))
    store.applyEvent(modelDeltaEvent({ sequence: 3, nodeId: "n1", delta: " world" }))

    expect(useRunStreamStore.getState().nodeExecutions.n1.metadata?.modelOutput).toBe("Hello world")
  })

  it("no-ops for a nodeId with no existing nodeExecutions entry, per the `if (ex)` guard", () => {
    useRunStreamStore.getState().applyEvent(modelDeltaEvent({ sequence: 1, nodeId: "ghost", delta: "hi" }))

    const state = useRunStreamStore.getState()
    expect(state.nodeExecutions.ghost).toBeUndefined()
    expect(state.nodeExecutions).toEqual({})
    // The event is still recorded in the raw log -- only the nodeExecutions
    // side effect is skipped.
    expect(state.events).toHaveLength(1)
  })
})

describe("useRunStreamStore.applyEvent -- terminal.stdout/stderr", () => {
  it("splits on newlines and filters empty lines, appending to terminalLines", () => {
    const store = useRunStreamStore.getState()
    store.applyEvent(terminalEvent({ sequence: 1, type: "terminal.stdout", content: "line1\nline2\n\nline3" }))
    expect(useRunStreamStore.getState().terminalLines).toEqual(["line1", "line2", "line3"])

    store.applyEvent(terminalEvent({ sequence: 2, type: "terminal.stderr", content: "err1\n\nerr2" }))
    expect(useRunStreamStore.getState().terminalLines).toEqual(["line1", "line2", "line3", "err1", "err2"])
  })
})

// The switch statement has no `case` (and no `default`) for these 4 event
// types -- confirmed by reading useRunStreamStore.ts directly. Confirmed
// separately, by grepping every consumer of this store repo-wide
// (run-detail.tsx, run-timeline.tsx, run-inspector.tsx, project-build.tsx),
// that NONE of them ever read `state.events` back out -- every consumer
// destructures nodeExecutions/runStatus/connectionStatus/terminalLines/
// selectedNodeId/connect/disconnect/clear, never `events`. So today, for
// every event type (not just these 4), `events` is a write-only raw log:
// appending to it has zero observable effect on the UI. These tests lock in
// that these 4 types are recorded and cause no crash and no other state
// change -- not that this is necessarily the *intended* final behavior (see
// the PR description for that judgment call).
describe("useRunStreamStore.applyEvent -- event types the switch does not handle", () => {
  it.each([
    ["artifact.created", () => artifactEvent({ sequence: 1 })],
    ["project.file.changed", () => projectFileEvent({ sequence: 1 })],
    ["test.started", () => testEvent({ sequence: 1, type: "test.started" })],
    ["test.completed", () => testEvent({ sequence: 1, type: "test.completed" })],
    ["human_action.created", () => humanActionEvent({ sequence: 1, type: "human_action.created" })],
    ["human_action.resolved", () => humanActionEvent({ sequence: 1, type: "human_action.resolved" })],
  ] as const satisfies ReadonlyArray<[string, () => RunEvent]>)(
    "%s is recorded in events and otherwise leaves state untouched",
    (_label, build) => {
      const before = useRunStreamStore.getState()
      const event = build()

      expect(() => before.applyEvent(event)).not.toThrow()

      const after = useRunStreamStore.getState()
      expect(after.events).toEqual([event])
      expect(after.lastSequence).toBe(1)
      expect(after.runStatus).toBe(before.runStatus)
      expect(after.nodeExecutions).toEqual(before.nodeExecutions)
      expect(after.terminalLines).toEqual(before.terminalLines)
    },
  )
})

describe("useRunStreamStore.applyEvent -- events log", () => {
  it("appends every accepted event to events, in arrival order", () => {
    const store = useRunStreamStore.getState()
    const e1 = runStatusEvent({ sequence: 1, type: "run.started", status: "running" })
    const e2 = nodeEvent({ sequence: 2, type: "node.started", nodeId: "n1", status: "running", attempt: 1, timestamp: "T0" })
    const e3 = terminalEvent({ sequence: 3, type: "terminal.stdout", content: "hi" })

    store.applyEvent(e1)
    store.applyEvent(e2)
    store.applyEvent(e3)

    expect(useRunStreamStore.getState().events).toEqual([e1, e2, e3])
  })
})
