import { Injectable } from "@nestjs/common";
import { EngineClient, type EngineEventStream } from "../engine";
import { permissionRevokedEvent, platformEvent } from "./envelope";
import {
  revocationMatches,
  StreamRevocationBus,
  streamRevocationBus,
} from "./revocation";
import { StreamProblemError, streamProblem } from "./problem";
import type {
  PlatformStreamEvent,
  StreamConnection,
  StreamFrame,
  StreamSink,
  StreamSubscriptionInput,
  StreamTarget,
  StreamingConfig,
} from "./types";

export const defaultStreamingConfig: StreamingConfig = {
  replayBufferSize: 256,
  subscriberQueueSize: 32,
  heartbeatMs: 15_000,
};

@Injectable()
export class StreamGateway {
  private readonly channels = new Map<string, Promise<StreamChannel>>();

  constructor(
    private readonly engine: EngineClient,
    private readonly config: StreamingConfig = defaultStreamingConfig,
    private readonly revocations: StreamRevocationBus = streamRevocationBus,
  ) {}

  async connect(input: StreamSubscriptionInput): Promise<StreamConnection> {
    const key = channelKey(input);
    let channelPromise = this.channels.get(key);
    if (!channelPromise) {
      channelPromise = this.createChannel(key, input);
      this.channels.set(key, channelPromise);
      void channelPromise.catch(() => this.channels.delete(key));
    }
    const channel = await channelPromise;
    return channel.add(input);
  }

  activeChannelCount(): number {
    return this.channels.size;
  }

  private async createChannel(
    key: string,
    input: StreamSubscriptionInput,
  ): Promise<StreamChannel> {
    const upstream = await this.engine.stream(
      enginePath(input.target),
      input.context,
    );
    return new StreamChannel(
      input.target,
      input.context,
      upstream,
      this.config,
      this.revocations,
      () => this.channels.delete(key),
    );
  }
}

class StreamChannel {
  private readonly subscribers = new Map<string, StreamSubscriber>();
  private readonly replayBuffer: PlatformStreamEvent[] = [];
  private readonly stopRevocationWatch: () => void;
  private closed = false;
  private started = false;
  private latestEventId: string | undefined;

  constructor(
    private readonly target: StreamTarget,
    actor: StreamSubscriptionInput["context"],
    private readonly upstream: EngineEventStream,
    private readonly config: StreamingConfig,
    revocations: StreamRevocationBus,
    private readonly onEmpty: () => void,
  ) {
    this.stopRevocationWatch = revocations.subscribe((signal) => {
      if (revocationMatches(signal, actor)) {
        this.close();
      }
    });
  }

  add(input: StreamSubscriptionInput): StreamConnection {
    if (this.subscribers.has(input.tabId)) {
      throw new StreamProblemError(
        streamProblem(409, "STREAM_TAB_ALREADY_CONNECTED", input.tabId),
      );
    }
    const subscriber = new StreamSubscriber(
      input.sink,
      this.config.subscriberQueueSize,
      () => this.remove(input.tabId),
      () => resyncEvent(this.target, this.latestEventId!, "backpressure"),
    );
    this.subscribers.set(input.tabId, subscriber);
    this.replay(input.lastEventId, subscriber);
    if (!this.started) {
      this.started = true;
      void this.pump();
    }
    return subscriber;
  }

  private replay(
    lastEventId: string | undefined,
    subscriber: StreamSubscriber,
  ): void {
    if (!lastEventId) {
      return;
    }
    const index = this.replayBuffer.findIndex(
      (event) => event.id === lastEventId,
    );
    if (index < 0) {
      subscriber.enqueue({
        kind: "event",
        event: resyncEvent(this.target, lastEventId, "stale_event_id"),
      });
      return;
    }
    for (const event of this.replayBuffer.slice(index + 1)) {
      subscriber.enqueue({ kind: "event", event });
    }
  }

  private async pump(): Promise<void> {
    const heartbeat = setInterval(
      () => this.broadcast({ kind: "comment", comment: "keepalive" }),
      this.config.heartbeatMs,
    );
    heartbeat.unref();
    try {
      for await (const message of this.upstream.messages) {
        if (message.event === permissionRevokedEvent) {
          break;
        }
        const event = platformEvent(this.target, message);
        this.latestEventId = event.id;
        this.replayBuffer.push(event);
        if (this.replayBuffer.length > this.config.replayBufferSize) {
          this.replayBuffer.shift();
        }
        this.broadcast({ kind: "event", event });
      }
    } catch {
      // Closing forces browser reconnect and fresh auth/RBAC validation.
    } finally {
      clearInterval(heartbeat);
      this.close();
    }
  }

  private broadcast(frame: StreamFrame): void {
    for (const subscriber of this.subscribers.values()) {
      subscriber.enqueue(frame);
    }
  }

  private remove(tabId: string): void {
    this.subscribers.delete(tabId);
    if (this.subscribers.size === 0) {
      this.close();
    }
  }

  private close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopRevocationWatch();
    this.upstream.close();
    for (const subscriber of [...this.subscribers.values()]) {
      subscriber.close();
    }
    this.subscribers.clear();
    this.onEmpty();
  }
}

class StreamSubscriber implements StreamConnection {
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private readonly queue: StreamFrame[] = [];
  private draining = false;
  private isClosed = false;
  private started = false;

  constructor(
    private readonly sink: StreamSink,
    private readonly maxQueueSize: number,
    private readonly onClose: () => void,
    private readonly overflowEvent: () => PlatformStreamEvent,
  ) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  enqueue(frame: StreamFrame): void {
    if (frame.kind === "comment") {
      if (this.queue.length < this.maxQueueSize) {
        this.queue.push(frame);
      }
    } else if (!this.coalesce(frame.event)) {
      if (this.queue.length >= this.maxQueueSize) {
        this.queue.splice(0, this.queue.length, {
          kind: "event",
          event: this.overflowEvent(),
        });
      } else {
        this.queue.push(frame);
      }
    }
    if (this.started) {
      void this.drain();
    }
  }

  start(): void {
    if (this.isClosed || this.started) {
      return;
    }
    this.started = true;
    void this.drain();
  }

  close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.queue.length = 0;
    this.resolveClosed();
    this.onClose();
  }

  pendingFrames(): number {
    return this.queue.length;
  }

  private coalesce(event: PlatformStreamEvent): boolean {
    if (!event.coalescible) {
      return false;
    }
    const index = this.queue.findIndex(
      (frame) =>
        frame.kind === "event" &&
        frame.event.coalescible &&
        frame.event.key === event.key,
    );
    if (index < 0) {
      return false;
    }
    this.queue[index] = { kind: "event", event };
    return true;
  }

  private async drain(): Promise<void> {
    if (this.draining || this.isClosed) {
      return;
    }
    this.draining = true;
    try {
      while (!this.isClosed) {
        const frame = this.queue.shift();
        if (!frame) {
          return;
        }
        await this.sink(frame);
      }
    } catch {
      this.close();
    } finally {
      this.draining = false;
    }
  }
}

function channelKey(input: StreamSubscriptionInput): string {
  const target =
    input.target.kind === "run"
      ? `run:${input.target.runId}`
      : `terminal:${input.target.projectId}:${input.target.runId}`;
  return [
    input.context.tenantId,
    input.context.userId,
    input.context.sessionId,
    [...input.context.roles].sort().join(","),
    [...input.context.permissions].sort().join(","),
    target,
  ].join(":");
}

function enginePath(target: StreamTarget): `/api/v1/${string}` {
  return target.kind === "run"
    ? `/api/v1/runs/${encodeURIComponent(target.runId)}/stream`
    : `/api/v1/projects/${encodeURIComponent(target.projectId)}/builds/${encodeURIComponent(target.runId)}/stream`;
}

function resyncEvent(
  target: StreamTarget,
  lastEventId: string,
  reason: "stale_event_id" | "backpressure",
): PlatformStreamEvent {
  const id = `${target.runId}:resync:${lastEventId}`;
  return {
    id,
    type: "stream.resync",
    data: { reason, refetch: true },
    key: id,
    coalescible: false,
  };
}
