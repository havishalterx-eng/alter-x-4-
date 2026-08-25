import { Logger } from "@nestjs/common";
import type { CanonicalEventConsumerService } from "./canonical-event-consumer.service";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives CanonicalEventConsumerService.pollOnce() in a loop -- only sleeps
 * when the queue was empty, so a real backlog drains immediately rather
 * than waiting a full poll interval between every message.
 */
export class CanonicalEventConsumerRunner {
  #running = false;
  #loopPromise: Promise<void> | undefined;

  constructor(
    private readonly consumer: CanonicalEventConsumerService,
    private readonly pollIntervalMs: number,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly logger: Logger = new Logger(CanonicalEventConsumerRunner.name),
  ) {}

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#loopPromise = this.#loop();
  }

  async stop(): Promise<void> {
    this.#running = false;
    await this.#loopPromise;
  }

  async #loop(): Promise<void> {
    while (this.#running) {
      try {
        const result = await this.consumer.pollOnce();
        if (result === "empty") {
          await this.sleep(this.pollIntervalMs);
        }
      } catch (error: unknown) {
        this.#logError(error);
      }
    }
  }

  #logError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(`Canonical event consumer poll failed: ${message}`, stack);
  }
}