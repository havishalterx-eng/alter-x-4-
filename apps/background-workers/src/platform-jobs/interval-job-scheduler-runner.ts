import { Logger } from "@nestjs/common";
import type { DurableExecutionProvider } from "@alterx/shared-clients";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Real periodic trigger for stateless sweep job types (no caller-supplied
 * window, unlike NotificationDigestSchedulerRunner) -- starts a real
 * platformJobWorkflow execution once per real interval. Real durability
 * and retry come from Temporal (the workflow itself), not this loop --
 * this loop only decides *when* to start one, mirroring
 * CostEventConsumerRunner's real interval-loop shape.
 */
export class IntervalJobSchedulerRunner {
  #running = false;
  #loopPromise: Promise<void> | undefined;

  constructor(
    private readonly durableExecution: DurableExecutionProvider,
    private readonly jobType: string,
    private readonly workflowIdPrefix: string,
    private readonly intervalMs: number,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly logger: Logger = new Logger(IntervalJobSchedulerRunner.name),
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
      await this.sleep(this.intervalMs);
      if (!this.#running) return;
      const tick = this.now();
      try {
        await this.durableExecution.startWorkflow({
          workflowType: "platformJobWorkflow",
          workflowId: `${this.workflowIdPrefix}-${tick.getTime()}`,
          input: {
            jobType: this.jobType,
            payloadJson: "{}",
          },
        });
      } catch (error: unknown) {
        this.#logError("startWorkflow", tick, error);
      }
    }
  }

  #logError(operation: string, tick: Date, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(
      `Interval scheduler tick failed for jobType=${this.jobType} operation=${operation} tick=${tick.toISOString()}: ${message}`,
      stack,
    );
  }
}
