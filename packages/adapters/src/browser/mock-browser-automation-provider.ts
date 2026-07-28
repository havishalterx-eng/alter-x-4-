import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  BrowserInspectionRequest,
  BrowserInspectionResult,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

import type {
  BrowserAutomationProvider,
  BrowserExtractionResult,
  BrowserNavigationResult,
  BrowserSession,
  BrowserSessionScope,
} from "./browserbase-playwright-provider";
import type { SsrfGuardedFetcher } from "../http/ssrf-guarded-fetcher";

const CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: true,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["local"],
  data_residency: ["local"],
  batch_support: false,
  maximum_payload: 1_048_576,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const METADATA: ProviderMetadata<"BrowserProvider"> = {
  providerId: "mock.browser-automation",
  interfaceName: "BrowserProvider",
  displayName: "Local Browser Automation Mock",
  version: "exec13-v1",
  telemetryNamespace: "alterx.adapters.browser.mock",
  supportsTenantOverrides: false,
  migration: { strategyVersion: "mock-browser-v1", rollbackSupported: true },
};

interface MockSession {
  readonly scope: BrowserSessionScope;
  url: string;
}

export class MockBrowserAutomationProvider
  implements BrowserAutomationProvider
{
  readonly metadata = METADATA;
  readonly capabilities = CAPABILITIES;
  readonly #sessions = new Map<string, MockSession>();
  readonly #urlGuard: Pick<SsrfGuardedFetcher, "assertAllowed">;
  #sequence = 0;

  constructor(urlGuard: Pick<SsrfGuardedFetcher, "assertAllowed">) {
    this.#urlGuard = urlGuard;
  }

  async createSession(scope: BrowserSessionScope): Promise<BrowserSession> {
    const sessionId = `browser_mock-${(this.#sequence += 1)}`;
    this.#sessions.set(sessionId, { scope, url: "about:blank" });
    return { sessionId, expiresAt: "2099-01-01T00:00:00.000Z" };
  }

  async inspectPage(request: BrowserInspectionRequest): Promise<BrowserInspectionResult> {
    await this.#urlGuard.assertAllowed(request.url);
    return {
      url: request.url,
      statusCode: 200,
      hasVisibleContent: true,
      consoleErrors: [],
    };
  }

  async navigate(
    scope: BrowserSessionScope,
    sessionId: string,
    url: string,
  ): Promise<BrowserNavigationResult> {
    await this.#urlGuard.assertAllowed(url);
    const session = this.#require(scope, sessionId);
    session.url = url;
    return { url, title: "Local mock page" };
  }

  async click(
    scope: BrowserSessionScope,
    sessionId: string,
    selector: string,
  ): Promise<void> {
    this.#require(scope, sessionId);
    if (selector.trim().length === 0) throw new Error("Browser selector is required");
  }

  async extract(
    scope: BrowserSessionScope,
    sessionId: string,
    selector = "body",
  ): Promise<BrowserExtractionResult> {
    const session = this.#require(scope, sessionId);
    return { text: `mock:${selector}`, url: session.url };
  }

  async closeSession(
    scope: BrowserSessionScope,
    sessionId: string,
  ): Promise<void> {
    this.#require(scope, sessionId);
    this.#sessions.delete(sessionId);
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      details: { configured: true, activeSessions: this.#sessions.size },
    };
  }

  #require(scope: BrowserSessionScope, sessionId: string): MockSession {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) throw new Error("Browser session was not found");
    if (
      session.scope.tenantId !== scope.tenantId ||
      session.scope.runId !== scope.runId ||
      session.scope.nodeExecutionId !== scope.nodeExecutionId ||
      session.scope.sandboxSessionId !== scope.sandboxSessionId
    ) {
      throw new Error("Browser session is not owned by this execution scope");
    }
    return session;
  }
}
