import { describe, expect, it, vi } from "vitest";
import { FetchServiceHealthTransport } from "./service-health-transport";

describe("FetchServiceHealthTransport", () => {
  it("uses real HTTP health endpoint request shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"status":"ok"}'));
    const transport = new FetchServiceHealthTransport(fetchImpl);
    const controller = new AbortController();

    await transport.getHealth("https://orchestration.internal/health", controller.signal);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://orchestration.internal/health",
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }),
    );
  });
});
