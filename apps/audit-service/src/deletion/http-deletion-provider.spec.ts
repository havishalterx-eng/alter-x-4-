import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpDeletionProvider } from "./http-deletion-provider";

describe("HttpDeletionProvider internal client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the service credential and maps every internal-only operation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ store: "fixture" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new HttpDeletionProvider("https://ads.internal/", "service-token", "ads-core");

    await provider.locateSubjectData("ten_fixture");
    await provider.deleteSubjectData("ten_fixture", "del_fixture");
    await provider.verifyDeletion("ten_fixture", "del_fixture");
    await provider.applyRetentionPolicy();
    await provider.listSubjectIds();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [, request] of fetchMock.mock.calls) {
      expect(request.headers.authorization).toBe("Bearer service-token");
    }
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://ads.internal/internal/deletion/locate?tenantId=ten_fixture",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ tenantId: "ten_fixture", manifestId: "del_fixture" }),
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe("https://ads.internal/internal/deletion/subjects");
    await expect(provider.replayDeletionLedger("2026-07-30T00:00:00Z")).rejects.toThrow(
      "coordinated by audit-service",
    );
  });

  it("never copies a remote response body into an error", async () => {
    const rawSubject = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: rawSubject }),
    }));
    const provider = new HttpDeletionProvider("https://ads.internal", "service-token", "ads-core");
    let message = "";
    try {
      await provider.listSubjectIds();
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("ads-core deletion request failed with status 503");
    expect(message).not.toContain(rawSubject);
  });
});
