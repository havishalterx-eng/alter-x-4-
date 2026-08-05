import { describe, expect, it, vi } from "vitest";
import type { ServiceHealthTransport } from "../engine/service-health-transport";
import {
  systemHealthConfigFromEnvironment,
  systemHealthServiceNames,
} from "./system-health.config";
import { SystemHealthService } from "./system-health.service";

describe("SystemHealthService", () => {
  it("calls every configured service health endpoint and returns healthy rollup", async () => {
    const transport = healthyTransport();
    const response = await service(transport).getHealth();

    expect(response.status).toBe("healthy");
    expect(response.services).toEqual(
      expect.arrayContaining(
        systemHealthServiceNames.map((name) =>
          expect.objectContaining({ name, status: "healthy" }),
        ),
      ),
    );
    expect(transport.getHealth).toHaveBeenCalledTimes(systemHealthServiceNames.length);
    expect(transport.getHealth).toHaveBeenCalledWith(
      "https://tool-gateway.internal/health",
      expect.any(AbortSignal),
    );
  });

  it("surfaces an unavailable backing service as down without failing aggregate", async () => {
    const transport = healthyTransport((url) =>
      url.includes("tool-gateway")
        ? new Response(null, { status: 503 })
        : new Response('{"status":"ok"}'),
    );

    const response = await service(transport).getHealth();

    expect(response.status).toBe("degraded");
    expect(response.services).toContainEqual(
      expect.objectContaining({ name: "tool-gateway", status: "down" }),
    );
    expect(response.services).toContainEqual(
      expect.objectContaining({ name: "model-gateway", status: "healthy" }),
    );
  });

  it("times out one backing service as down without blocking other results", async () => {
    const transport = healthyTransport((url, signal) => {
      if (!url.includes("sandbox-service")) {
        return new Response('{"status":"ok"}');
      }

      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("timeout");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const response = await service(transport, 10).getHealth();

    expect(response.status).toBe("degraded");
    expect(response.services).toContainEqual(
      expect.objectContaining({ name: "sandbox-service", status: "down" }),
    );
    expect(response.services).toContainEqual(
      expect.objectContaining({ name: "ads-core", status: "healthy" }),
    );
  });

  it("marks omitted endpoint configuration down instead of fabricating healthy", async () => {
    const health = new SystemHealthService(
      systemHealthConfigFromEnvironment({}),
      healthyTransport(),
    );

    await expect(health.getHealth()).resolves.toEqual({
      status: "degraded",
      services: systemHealthServiceNames.map((name) => ({
        name,
        status: "down",
        latency_ms: 0,
      })),
    });
  });

  it("rejects incomplete or unknown endpoint configuration", () => {
    expect(() =>
      systemHealthConfigFromEnvironment({
        SYSTEM_HEALTH_ENDPOINTS_JSON: JSON.stringify({
          "ads-core": "https://ads-core.internal",
        }),
      }),
    ).toThrow("missing audit-service");
    expect(() =>
      systemHealthConfigFromEnvironment({
        SYSTEM_HEALTH_ENDPOINTS_JSON: JSON.stringify({
          unknown: "https://unknown.internal",
        }),
      }),
    ).toThrow("unknown service unknown");
  });
});

function service(
  transport: ServiceHealthTransport,
  timeoutMs = 100,
): SystemHealthService {
  return new SystemHealthService(
    {
      timeoutMs,
      targets: systemHealthServiceNames.map((name) => ({
        name,
        baseUrl: `https://${name}.internal`,
      })),
    },
    transport,
  );
}

function healthyTransport(
  response: (url: string, signal: AbortSignal) => Response | Promise<Response> = () =>
    new Response('{"status":"ok"}'),
): ServiceHealthTransport & { getHealth: ReturnType<typeof vi.fn> } {
  return {
    getHealth: vi.fn((url: string, signal: AbortSignal) =>
      Promise.resolve(response(url, signal)),
    ),
  };
}
