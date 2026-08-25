import { Logger } from "@nestjs/common";
import type { DurableExecutionProvider } from "@alterx/shared-clients";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Real periodic trigger: starts a real platformJobWorkflow execution
 * (jobType "platform.notification-digest") once per real interval,
 * covering the window since its last successful tick. Real durability
 * and retry come from Temporal (the workflow itself), not this loop --
 * this loop only decides *when* to start one, mirroring
 * CostEventConsumerRunner's real interval-loop shape.
 */
export class NotificationDigestSchedulerRunner {
  #running = false;
  #loopPromise: Promise<void> | undefined;
  #windowStart: Date;

  constructor(
    private readonly durableExecution: DurableExecutionProvider,
    private readonly intervalMs: number,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly logger: Logger = new Logger(NotificationDigestSchedulerRunner.name),
  ) {
    this.#windowStart = this.now();
  }

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
      await this.sleep(this.intervalMs);
      if (!this.#running) return;
      const periodEnd = this.now();
      const periodStart = this.#windowStart;
      this.#windowStart = periodEnd;
      try {
        await this.durableExecution.startWorkflow({
          workflowType: "platformJobWorkflow",
          workflowId: `notification-digest-${periodEnd.getTime()}`,
          input: {
            jobType: "platform.notification-digest",
            payloadJson: JSON.stringify({
              period_start: periodStart.toISOString(),
              period_end: periodEnd.toISOString(),
            }),
          },
        });
      } catch (error: unknown) {
        this.#logError("startWorkflow", periodStart, periodEnd, error);
      }
    }
  }

  #logError(
    operation: string,
    periodStart: Date,
    periodEnd: Date,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(
      `Notification digest scheduler tick failed jobType=platform.notification-digest operation=${operation} periodStart=${periodStart.toISOString()} periodEnd=${periodEnd.toISOString()}: ${message}`,
      stack,
    );
  }
}
