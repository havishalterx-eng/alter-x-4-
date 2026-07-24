import type { EngineCallerContext } from "../engine";

export type StreamTarget =
  | { kind: "run"; runId: string }
  | {
      kind: "terminal";
      projectId: string;
      runId: string;
    };

export interface PlatformStreamEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  key: string;
  coalescible: boolean;
}

export type StreamFrame =
  | { kind: "comment"; comment: string }
  | { kind: "event"; event: PlatformStreamEvent };

export type StreamSink = (frame: StreamFrame) => Promise<void>;

export interface StreamSubscriptionInput {
  tabId: string;
  lastEventId?: string;
  target: StreamTarget;
  context: EngineCallerContext;
  sink: StreamSink;
}

export interface StreamConnection {
  closed: Promise<void>;
  start(): void;
  close(): void;
  pendingFrames(): number;
}

export interface StreamingConfig {
  replayBufferSize: number;
  subscriberQueueSize: number;
  heartbeatMs: number;
  replayGraceMs: number;
}
