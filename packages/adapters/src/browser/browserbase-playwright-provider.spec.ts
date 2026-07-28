import { describe, expect, it, vi } from "vitest";

import {
  BrowserbasePlaywrightProvider,
  type BrowserSessionScope,
  type BrowserbaseSessionClient,
  type PlaywrightBrowserHandle,
  type PlaywrightConnector,
  type PlaywrightPageHandle,
} from "./browserbase-playwright-provider";

const SCOPE: BrowserSessionScope = {
  tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
  runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
  nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
  sandboxSessionId: "ses_exec-10",
};

function harness(options: { readonly sessionIds?: readonly string[] } = {}) {
  const sessionIds = [...(options.sessionIds ?? ["bb_session-1"])];
  const goto = vi.fn(async () => undefined);
  const click = vi.fn(async () => undefined);
  const innerText = vi.fn(async () => "extracted text");
  const close = vi.fn(async () => undefined);
  const page: PlaywrightPageHandle = {
    goto,
    title: async () => "Example",
    url: () => "https://example.com/final",
    locator: () => ({ click, innerText }),
  };
  const browser: PlaywrightBrowserHandle = {
    contexts: () => [{ pages: () => [page], newPage: async () => page }],
    close,
  };
  const create = vi.fn(async () => ({
    id: sessionIds.shift() ?? "bb_fallback",
    connectUrl: "wss://connect.browserbase.test/session",
  }));
  const connectOverCDP = vi.fn(async () => browser);
  const assertAllowed = vi.fn(async () => undefined);
  const provider = new BrowserbasePlaywrightProvider(
    {
      apiKey: "test-reference-resolved-inside-bootstrap",
      projectId: "project-test",
      maxSessions: 2,
      sessionTtlMs: 1_000,
      operationTimeoutMs: 500,
    },
    { assertAllowed },
    { create } satisfies BrowserbaseSessionClient,
    { connectOverCDP } satisfies PlaywrightConnector,
    () => new Date("2026-07-28T00:00:00.000Z"),
  );
  return {
    assertAllowed,
    browser,
    click,
    close,
    connectOverCDP,
    create,
    goto,
    innerText,
    provider,
  };
}

describe("BrowserbasePlaywrightProvider", () => {
  it("creates a scoped Browserbase session and drives Playwright primitives", async () => {
    const target = harness();
    const session = await target.provider.createSession(SCOPE);

    expect(session).toEqual({
      sessionId: "bb_session-1",
      expiresAt: "2026-07-28T00:00:01.000Z",
    });
    expect(target.create).toHaveBeenCalledWith({
      projectId: "project-test",
      region: "ap-southeast-1",
      userMetadata: {
        tenant_id: SCOPE.tenantId,
        run_id: SCOPE.runId,
        node_execution_id: SCOPE.nodeExecutionId,
        sandbox_session_id: SCOPE.sandboxSessionId,
      },
    });
    expect(target.connectOverCDP).toHaveBeenCalledWith(
      "wss://connect.browserbase.test/session",
    );

    await expect(
      target.provider.navigate(SCOPE, session.sessionId, "https://example.com"),
    ).resolves.toEqual({ url: "https://example.com/final", title: "Example" });
    expect(target.assertAllowed).toHaveBeenCalledWith("https://example.com");
    expect(target.goto).toHaveBeenCalledWith("https://example.com", {
      timeout: 500,
      waitUntil: "domcontentloaded",
    });

    await target.provider.click(SCOPE, session.sessionId, "#submit");
    expect(target.click).toHaveBeenCalledWith({ timeout: 500 });
    await expect(
      target.provider.extract(SCOPE, session.sessionId, "main"),
    ).resolves.toEqual({
      text: "extracted text",
      url: "https://example.com/final",
    });
  });

  it("rejects cross-tenant session access", async () => {
    const target = harness();
    const session = await target.provider.createSession(SCOPE);

    await expect(
      target.provider.extract(
        { ...SCOPE, tenantId: "ten_018f47a2-7b11-7b11-8a11-0000000000bb" },
        session.sessionId,
      ),
    ).rejects.toThrow("not owned");
  });

  it("sweeps expired sessions and bounds live session storage", async () => {
    let nowMs = Date.parse("2026-07-28T00:00:00.000Z");
    const target = harness({ sessionIds: ["bb_1", "bb_2", "bb_3"] });
    const provider = new BrowserbasePlaywrightProvider(
      {
        apiKey: "test-key",
        projectId: "project-test",
        maxSessions: 1,
        sessionTtlMs: 1_000,
      },
      { assertAllowed: target.assertAllowed },
      { create: target.create } satisfies BrowserbaseSessionClient,
      { connectOverCDP: target.connectOverCDP } satisfies PlaywrightConnector,
      () => new Date(nowMs),
    );

    const first = await provider.createSession(SCOPE);
    const second = await provider.createSession(SCOPE);
    expect(target.close).toHaveBeenCalledTimes(1);
    await expect(provider.extract(SCOPE, first.sessionId)).rejects.toThrow(
      "not found",
    );
    await expect(provider.extract(SCOPE, second.sessionId)).resolves.toBeDefined();

    nowMs += 1_001;
    await provider.createSession(SCOPE);
    expect(target.close).toHaveBeenCalledTimes(2);
  });

  it("stays bounded when session creation races concurrently", async () => {
    const target = harness({ sessionIds: ["bb_1", "bb_2", "bb_3"] });
    const provider = new BrowserbasePlaywrightProvider(
      {
        apiKey: "test-key",
        projectId: "project-test",
        maxSessions: 1,
      },
      { assertAllowed: target.assertAllowed },
      { create: target.create } satisfies BrowserbaseSessionClient,
      { connectOverCDP: target.connectOverCDP } satisfies PlaywrightConnector,
    );

    const sessions = await Promise.all([
      provider.createSession(SCOPE),
      provider.createSession(SCOPE),
      provider.createSession(SCOPE),
    ]);

    expect(target.close).toHaveBeenCalledTimes(2);
    await expect(provider.extract(SCOPE, sessions[0]?.sessionId ?? "")).rejects.toThrow(
      "not found",
    );
    await expect(provider.extract(SCOPE, sessions[1]?.sessionId ?? "")).rejects.toThrow(
      "not found",
    );
    await expect(provider.extract(SCOPE, sessions[2]?.sessionId ?? "")).resolves.toBeDefined();
  });

  it("fails closed when URL validation rejects navigation", async () => {
    const target = harness();
    target.assertAllowed.mockRejectedValueOnce(new Error("blocked SSRF target"));
    const session = await target.provider.createSession(SCOPE);

    await expect(
      target.provider.navigate(
        SCOPE,
        session.sessionId,
        "https://169.254.169.254/latest/meta-data/",
      ),
    ).rejects.toThrow("blocked SSRF");
    expect(target.goto).not.toHaveBeenCalled();
  });

  it("rejects invalid config and reports bounded health", async () => {
    expect(
      () =>
        new BrowserbasePlaywrightProvider(
          { apiKey: "", projectId: "project" },
          { assertAllowed: async () => undefined },
        ),
    ).toThrow("API key");
    const target = harness();
    await expect(target.provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
      details: { activeSessions: 0, maxSessions: 2 },
    });
  });
});
