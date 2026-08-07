import { createMockSecretsProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";
import {
  AtlassianStatusPageProvider,
  type StatusPageHttpClient,
} from "./atlassian-status-page-provider";

describe("AtlassianStatusPageProvider", () => {
  it("publishes through official page incident endpoint using secret reference", async () => {
    const request = vi.fn<StatusPageHttpClient["request"]>().mockResolvedValue({
      status: 201,
      body: {
        id: "inc_123",
        status: "investigating",
        created_at: "2026-08-06T05:00:00Z",
      },
    });
    const provider = new AtlassianStatusPageProvider(
      { pageId: "page_123", apiTokenSecretRef: "statuspage/token" },
      createMockSecretsProvider({
        secrets: { "statuspage/token": "private-token" },
      }),
      { request },
    );

    await expect(provider.publishIncident({
      title: "Elevated API errors",
      body: "Investigating elevated errors.",
      status: "investigating",
      impact: "major",
      notifySubscribers: true,
    })).resolves.toEqual({
      providerIncidentRef: "inc_123",
      status: "investigating",
      publishedAt: "2026-08-06T05:00:00.000Z",
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/pages/page_123/incidents",
      authorization: "OAuth private-token",
      body: {
        incident: {
          name: "Elevated API errors",
          body: "Investigating elevated errors.",
          status: "investigating",
          impact_override: "major",
          deliver_notifications: true,
        },
      },
    });
  });

  it("returns unhealthy without leaking provider errors", async () => {
    const provider = new AtlassianStatusPageProvider(
      { pageId: "page_123", apiTokenSecretRef: "statuspage/token" },
      createMockSecretsProvider({
        secrets: { "statuspage/token": "private-token" },
      }),
      { request: vi.fn().mockRejectedValue(new Error("private-token")) },
      () => new Date("2026-08-06T05:00:00Z"),
    );
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "unhealthy",
      latencyMs: 0,
    });
  });
});
