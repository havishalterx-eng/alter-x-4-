import { Injectable } from "@nestjs/common";
import type { ServiceHealthTransport } from "../engine/service-health-transport";
import type { SystemHealthConfig, SystemHealthTarget } from "./system-health.config";

export type ServiceHealthStatus = "healthy" | "degraded" | "down";
export type SystemHealthStatus = "healthy" | "degraded";

export interface SystemHealthServiceEntry {
  readonly name: string;
  readonly status: ServiceHealthStatus;
  readonly latency_ms: number;
}

export interface SystemHealthResponse {
  readonly status: SystemHealthStatus;
  readonly services: readonly SystemHealthServiceEntry[];
}

@Injectable()
export class SystemHealthService {
  constructor(
    private readonly config: SystemHealthConfig,
    private readonly transport: ServiceHealthTransport,
    private readonly now: () => number = Date.now,
  ) {}

  async getHealth(): Promise<SystemHealthResponse> {
    const services = await Promise.all(
      this.config.targets.map((target) => this.checkTarget(target)),
    );

    return {
      status: services.every((service) => service.status === "healthy")
        ? "healthy"
        : "degraded",
      services,
    };
  }

  private async checkTarget(target: SystemHealthTarget): Promise<SystemHealthServiceEntry> {
    if (target.baseUrl === undefined) {
      return { name: target.name, status: "down", latency_ms: 0 };
    }

    const startedAt = this.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.transport.getHealth(
        `${target.baseUrl}/health`,
        controller.signal,
      );
      const latency_ms = this.now() - startedAt;
      if (!response.ok) {
        return { name: target.name, status: "down", latency_ms };
      }

      const payload = await response.json().catch(() => undefined) as unknown;
      return {
        name: target.name,
        status: healthStatus(payload),
        latency_ms,
      };
    } catch {
      return {
        name: target.name,
        status: "down",
        latency_ms: this.now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function healthStatus(payload: unknown): ServiceHealthStatus {
  if (payload === null || typeof payload !== "object") return "degraded";
  const status = (payload as { status?: unknown }).status;
  if (status === "ok" || status === "healthy") return "healthy";
  if (status === "degraded") return "degraded";
  return "down";
}
