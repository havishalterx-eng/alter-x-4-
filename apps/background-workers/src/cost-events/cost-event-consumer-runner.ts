import type { CostEventConsumerService } from "./cost-event-consumer.service";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives CostEventConsumerService.pollOnce() in a loop -- only sleeps when
 * the queue was empty, so a real backlog drains immediately rather than
 * waiting a full poll interval between every message.
 */
export class CostEventConsumerRunner {
  #running = false;
  #loopPromise: Promise<void> | undefined;

  constructor(
    private readonly consumer: CostEventConsumerService,
    private readonly pollIntervalMs: number,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
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
      const result = await this.consumer.pollOnce();
      if (result === "empty") {
        await this.sleep(this.pollIntervalMs);
      }
    }
  }
}
