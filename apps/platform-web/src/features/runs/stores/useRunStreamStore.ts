import { create } from "zustand"
import { type RunEvent, type RunNodeExecution, type RunStatus } from "@/api/types"
import { runStream } from "@/api/stream"

type StreamConnectionStatus = "connecting" | "connected" | "disconnected" | "closed"

export interface RunStreamState {
  events: RunEvent[]
  nodeExecutions: Record<string, RunNodeExecution>
  runStatus: RunStatus
  connectionStatus: StreamConnectionStatus
  lastSequence: number
  selectedNodeId?: string
  autoFollow: boolean
  terminalLines: string[]
  
  connect: (runId: string) => void
  disconnect: () => void
  applyEvent: (event: RunEvent) => void
  setSelectedNodeId: (id?: string) => void
  setAutoFollow: (auto: boolean) => void
  clear: () => void
}

export const useRunStreamStore = create<RunStreamState>((set, get) => ({
  events: [],
  nodeExecutions: {},
  runStatus: "queued",
  connectionStatus: "disconnected",
  lastSequence: 0,
  selectedNodeId: undefined,
  autoFollow: true,
  terminalLines: [],

  connect: async (runId: string) => {
    set({ connectionStatus: "connecting" })
    try {
      const stream = runStream.connect(runId, { afterSequence: get().lastSequence })
      set({ connectionStatus: "connected" })

      for await (const event of stream) {
        if (get().connectionStatus === "disconnected" || get().connectionStatus === "closed") break
        get().applyEvent(event)
      }
      
      set({ connectionStatus: "closed" })
    } catch (e) {
      console.error("Stream connection failed", e)
      set({ connectionStatus: "disconnected" })
    }
  },

  disconnect: () => {
    runStream.disconnect()
    set({ connectionStatus: "closed" })
  },

  applyEvent: (event: RunEvent) => {
    set((state) => {
      // Deduplicate
      if (event.sequence <= state.lastSequence) return state

      const newState = { ...state, lastSequence: event.sequence, events: [...state.events, event] }

      switch (event.type) {
        case "run.status":
        case "run.started":
        case "run.completed":
        case "run.failed": {
          const e = event as any
          newState.runStatus = e.status || (e.type === "run.completed" ? "completed" : e.type === "run.failed" ? "failed" : "running")
          break
        }

        case "node.started":
        case "node.completed":
        case "node.failed":
        case "node.waiting":
        case "node.retrying": {
          const e = event as any
          const ex = state.nodeExecutions[e.nodeId] || {
            id: `exec_${e.nodeId}`,
            runId: e.runId,
            nodeId: e.nodeId,
            nodeName: e.nodeId,
            nodeType: "unknown",
            status: "pending",
            attempt: e.attempt,
            startedAt: e.type === "node.started" ? e.timestamp : undefined,
          }
          ex.status = e.status || (e.type === "node.completed" ? "completed" : e.type === "node.failed" ? "failed" : "running")
          ex.attempt = e.attempt
          if (e.type === "node.completed" || e.type === "node.failed") {
            ex.completedAt = e.timestamp
            if (ex.startedAt) {
              ex.durationMs = new Date(e.timestamp).getTime() - new Date(ex.startedAt).getTime()
            }
          }
          newState.nodeExecutions = { ...state.nodeExecutions, [e.nodeId]: { ...ex } }
          break
        }

        case "model.delta": {
          const e = event as any
          const ex = state.nodeExecutions[e.nodeId]
          if (ex) {
            const currentOutput = (ex.metadata?.modelOutput as string) || ""
            ex.metadata = { ...ex.metadata, modelOutput: currentOutput + event.delta }
            newState.nodeExecutions = { ...state.nodeExecutions, [event.nodeId]: { ...ex } }
          }
          break
        }

        case "terminal.stdout":
        case "terminal.stderr": {
          const e = event as any
          const lines = e.content.split("\n").filter(Boolean)
          newState.terminalLines = [...state.terminalLines, ...lines]
          break
        }
      }

      return newState
    })
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setAutoFollow: (auto) => set({ autoFollow: auto }),
  
  clear: () => set({
    events: [],
    nodeExecutions: {},
    runStatus: "queued",
    connectionStatus: "disconnected",
    lastSequence: 0,
    selectedNodeId: undefined,
    autoFollow: true,
    terminalLines: []
  })
}))
