import { type RunEvent } from "./types"

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

export const runStream = new MockSSEAdapter()
