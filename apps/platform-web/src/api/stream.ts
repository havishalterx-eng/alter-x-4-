import { baseUrl, isLiveApi } from "./http"
import { type RunEvent, type RunStatus } from "./types"

export interface RunEventStream {
  connect(
    runId: string,
    options?: {
      afterSequence?: number
    }
  ): AsyncIterable<RunEvent>
  
  disconnect(): void
}

class MockSSEAdapter implements RunEventStream {
  private activeStreams: Map<string, boolean> = new Map()

  async *connect(
    runId: string,
    options?: { afterSequence?: number }
  ): AsyncIterable<RunEvent> {
    this.activeStreams.set(runId, true)
    
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 500))

    let sequence = options?.afterSequence || 0

    // Deterministic mock scenarios based on runId
    if (runId.includes("failed") || runId === "run_01JAX48P") {
      yield this.createEvent(runId, ++sequence, { type: "run.started", status: "running" } as any)
      await this.delay(800)
      
      yield this.createEvent(runId, ++sequence, { type: "node.started", nodeId: "node_1", attempt: 1, status: "running" } as any)
      await this.delay(1000)
      
      yield this.createEvent(runId, ++sequence, { type: "terminal.stderr", content: "Connection to Slack API failed\n" } as any)
      yield this.createEvent(runId, ++sequence, { type: "node.failed", nodeId: "node_1", attempt: 1, status: "failed" } as any)
      
      yield this.createEvent(runId, ++sequence, { type: "run.failed", status: "failed" } as any)
      return
    }

    if (runId.includes("proj") || runId === "run_01JAX77P") {
      yield this.createEvent(runId, ++sequence, { type: "run.started", status: "running" } as any)
      await this.delay(500)
      
      yield this.createEvent(runId, ++sequence, { type: "terminal.stdout", content: "Initializing project build...\n" } as any)
      await this.delay(1000)
      
      yield this.createEvent(runId, ++sequence, { type: "project.file.changed", fileId: "src/main.tsx", status: "modified" } as any)
      yield this.createEvent(runId, ++sequence, { type: "terminal.stdout", content: "Updated src/main.tsx\n" } as any)
      await this.delay(800)
      
      yield this.createEvent(runId, ++sequence, { type: "test.started", testId: "test_1" } as any)
      await this.delay(500)
      yield this.createEvent(runId, ++sequence, { type: "test.completed", testId: "test_1" } as any)
      
      yield this.createEvent(runId, ++sequence, { type: "terminal.stdout", content: "Build completed successfully.\n" } as any)
      yield this.createEvent(runId, ++sequence, { type: "run.completed", status: "completed" } as any)
      return
    }

    // Default successful workflow simulation
    yield this.createEvent(runId, ++sequence, { type: "run.started", status: "running" } as any)
    await this.delay(600)

    yield this.createEvent(runId, ++sequence, { type: "node.started", nodeId: "trigger_1", attempt: 1, status: "running" } as any)
    await this.delay(800)
    yield this.createEvent(runId, ++sequence, { type: "node.completed", nodeId: "trigger_1", attempt: 1, status: "completed" } as any)
    
    await this.delay(400)
    
    yield this.createEvent(runId, ++sequence, { type: "node.started", nodeId: "ai_1", attempt: 1, status: "running" } as any)
    
    // Simulate model delta
    const response = "The user request seems to be asking for a password reset."
    const words = response.split(" ")
    for (const word of words) {
      if (!this.activeStreams.get(runId)) return
      await this.delay(200)
      yield this.createEvent(runId, ++sequence, { type: "model.delta", nodeId: "ai_1", delta: word + " " } as any)
    }
    
    yield this.createEvent(runId, ++sequence, { type: "node.completed", nodeId: "ai_1", attempt: 1, status: "completed" } as any)
    
    await this.delay(500)
    
    yield this.createEvent(runId, ++sequence, { type: "artifact.created", artifactId: "art_new_1" } as any)
    yield this.createEvent(runId, ++sequence, { type: "run.completed", status: "completed" } as any)
  }

  disconnect(): void {
    // In a real adapter, we would close the EventSource connection here.
    this.activeStreams.clear()
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private createEvent(runId: string, sequence: number, partialEvent: Partial<RunEvent>): RunEvent {
    return {
      id: `evt_${Date.now()}_${sequence}`,
      runId,
      sequence,
      timestamp: new Date().toISOString(),
      ...partialEvent
    } as RunEvent
  }
}

// ENGINE-FIX-P3-9: real GET /stream/runs/:runId SSE endpoint already exists
// (apps/platform-api/src/streaming/stream.controller.ts) -- this was the
// only consumer left on the mock. Uses fetch + ReadableStream rather than
// native EventSource because resume-after-disconnect needs a real
// Last-Event-ID *request* header on the initial connection (the server
// validates it: `${runId}:${sequence}`), and EventSource has no API to set
// custom headers -- only automatic browser-reconnects send Last-Event-ID,
// never a caller-supplied initial value. fetch has no such limit and needs
// no extra dependency.
class LiveSSEAdapter implements RunEventStream {
  private controller: AbortController | null = null

  async *connect(
    runId: string,
    options?: { afterSequence?: number }
  ): AsyncIterable<RunEvent> {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller

    const tabId = getTabId()
    const url = `${baseUrl}/stream/runs/${encodeURIComponent(runId)}?tab_id=${encodeURIComponent(tabId)}`
    const headers: Record<string, string> = { Accept: "text/event-stream" }
    if (options?.afterSequence) {
      headers["Last-Event-ID"] = `${runId}:${options.afterSequence}`
    }

    let response: Response
    try {
      response = await fetch(url, { headers, credentials: "include", signal: controller.signal })
    } catch (error) {
      if (isAbort(error)) return
      throw error
    }
    if (!response.ok || !response.body) {
      throw new Error(`Stream connection failed: HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let separatorIndex: number
        while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawFrame = buffer.slice(0, separatorIndex)
          buffer = buffer.slice(separatorIndex + 2)
          const event = parseFrame(rawFrame)
          if (event) yield event
        }
      }
    } catch (error) {
      if (!isAbort(error)) throw error
    } finally {
      reader.releaseLock()
    }
  }

  disconnect(): void {
    this.controller?.abort()
    this.controller = null
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function getTabId(): string {
  const key = "alterx_tab_id"
  const existing = sessionStorage.getItem(key)
  if (existing) return existing
  const id = crypto.randomUUID()
  sessionStorage.setItem(key, id)
  return id
}

// One SSE frame is `id: ...\nevent: ...\ndata: ...\n\n` (writeFrame in
// stream.controller.ts); `: comment` heartbeat lines have no id/event and
// are dropped. `data:` can repeat per the SSE spec -- concatenated with \n.
function parseFrame(rawFrame: string): RunEvent | undefined {
  let id: string | undefined
  let type: string | undefined
  const dataLines: string[] = []

  for (const line of rawFrame.split("\n")) {
    if (line.startsWith(":")) continue
    if (line.startsWith("id:")) id = line.slice(3).trim()
    else if (line.startsWith("event:")) type = line.slice(6).trim()
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
  }
  if (!id || !type || dataLines.length === 0) return undefined

  let data: Record<string, unknown>
  try {
    data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>
  } catch {
    return undefined
  }

  return toRunEvent(type, id, data)
}

// The engine's real SSE vocabulary (packages/contracts/src/sse.ts) has 13
// event types; useRunStreamStore.applyEvent only switches on the 8 below
// (run status/completion, node lifecycle, model deltas, terminal output).
// verification.result / recovery.action / clarification.requested /
// approval.requested / deployment.status have no RunEvent case yet --
// dropped here rather than mis-typed, since forcing them through the
// RunEvent union would silently lie about their shape.
function toRunEvent(type: string, id: string, data: Record<string, unknown>): RunEvent | undefined {
  const sequence = Number(id.slice(id.lastIndexOf(":") + 1))
  const runId = String(data.runId ?? "")
  const timestamp = String(data.timestamp ?? new Date().toISOString())
  const payload = (data.payload ?? {}) as Record<string, unknown>

  switch (type) {
    case "run.status":
      return { id, runId, sequence, timestamp, type: "run.status", status: mapRunStatus(payload.status) }
    case "run.completed":
      return { id, runId, sequence, timestamp, type: "run.completed", status: "completed" }
    case "run.degraded":
      return { id, runId, sequence, timestamp, type: "run.status", status: "degraded" }
    case "node.started":
      return {
        id, runId, sequence, timestamp, type: "node.started",
        nodeId: String(payload.dag_node_key), status: "running", attempt: Number(payload.attempt ?? 1),
      }
    case "node.completed":
      return {
        id, runId, sequence, timestamp, type: "node.completed",
        nodeId: String(payload.dag_node_key), status: "completed", attempt: Number(payload.attempt ?? 1),
      }
    case "node.failed":
      return {
        id, runId, sequence, timestamp, type: "node.failed",
        nodeId: String(payload.dag_node_key), status: "failed", attempt: Number(payload.attempt ?? 1),
      }
    case "model.delta":
      return {
        id, runId, sequence, timestamp, type: "model.delta",
        nodeId: String(payload.node_execution_id), delta: String(payload.delta ?? ""),
      }
    case "terminal.frame":
      return {
        id, runId, sequence, timestamp,
        type: data.stream === "stderr" ? "terminal.stderr" : "terminal.stdout",
        content: String(data.data ?? ""),
      }
    default:
      return undefined
  }
}

// Engine run status (packages/contracts/src/sse.ts RunStatusSchema) and the
// platform's display RunStatus (api/types.ts) are different, overlapping
// vocabularies -- mapped rather than cast so an unrecognized value fails
// visibly (falls through to "running") instead of silently mistyping.
function mapRunStatus(value: unknown): RunStatus {
  switch (value) {
    case "running": return "running"
    case "completed": return "completed"
    case "failed": return "failed"
    case "degraded": return "degraded"
    case "paused":
    case "waiting_approval": return "waiting"
    case "escalated": return "waiting"
    case "abandoned": return "cancelled"
    default: return "running"
  }
}

export const runStream: RunEventStream = isLiveApi ? new LiveSSEAdapter() : new MockSSEAdapter()
