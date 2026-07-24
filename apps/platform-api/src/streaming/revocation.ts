import { EventEmitter } from "node:events";

export interface StreamRevocation {
  tenantId: string;
  userId?: string;
  sessionId?: string;
}

export class StreamRevocationBus {
  private readonly emitter = new EventEmitter();

  publish(signal: StreamRevocation): void {
    this.emitter.emit("revoked", signal);
  }

  subscribe(listener: (signal: StreamRevocation) => void): () => void {
    this.emitter.on("revoked", listener);
    return () => this.emitter.off("revoked", listener);
  }
}

export const streamRevocationBus = new StreamRevocationBus();

export function revocationMatches(
  signal: StreamRevocation,
  actor: { tenantId: string; userId: string; sessionId: string },
): boolean {
  return (
    signal.tenantId === actor.tenantId &&
    (!signal.userId || signal.userId === actor.userId) &&
    (!signal.sessionId || signal.sessionId === actor.sessionId)
  );
}
