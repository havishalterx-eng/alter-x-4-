import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright-core";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  BrowserInspectionRequest,
  BrowserInspectionResult,
  BrowserProvider,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

import type { SsrfGuardedFetcher } from "../http/ssrf-guarded-fetcher";

export interface BrowserSessionScope {
  readonly tenantId: string;
  readonly runId: string;
  readonly nodeExecutionId: string;
  readonly sandboxSessionId: string;
}

export interface BrowserSession {
  readonly sessionId: string;
  readonly expiresAt: string;
}

export interface BrowserNavigationResult {
  readonly url: string;
  readonly title: string;
}

export interface BrowserExtractionResult {
  readonly text: string;
  readonly url: string;
}

/** Swappable operation port until canonical BrowserProvider v1 gains methods. */
export interface BrowserAutomationProvider extends BrowserProvider {
  createSession(scope: BrowserSessionScope): Promise<BrowserSession>;
  navigate(
    scope: BrowserSessionScope,
    sessionId: string,
    url: string,
  ): Promise<BrowserNavigationResult>;
  click(
    scope: BrowserSessionScope,
    sessionId: string,
    selector: string,
  ): Promise<void>;
  extract(
    scope: BrowserSessionScope,
    sessionId: string,
    selector?: string,
  ): Promise<BrowserExtractionResult>;
  closeSession(scope: BrowserSessionScope, sessionId: string): Promise<void>;
}

interface BrowserbaseSession {
  readonly id: string;
  readonly connectUrl: string;
}

export interface BrowserbaseSessionClient {
  create(input: {
    readonly projectId: string;
    readonly region: "ap-southeast-1";
    readonly userMetadata: Readonly<Record<string, string>>;
  }): Promise<BrowserbaseSession>;
}

export interface PlaywrightPageHandle {
  goto(
    url: string,
    options: { readonly timeout: number; readonly waitUntil: "domcontentloaded" },
  ): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  locator(selector: string): {
    click(options: { readonly timeout: number }): Promise<void>;
    innerText(options: { readonly timeout: number }): Promise<string>;
  };
}

export interface PlaywrightBrowserHandle {
  contexts(): readonly {
    pages(): readonly PlaywrightPageHandle[];
    newPage(): Promise<PlaywrightPageHandle>;
  }[];
  close(): Promise<void>;
}

export interface PlaywrightConnector {
  connectOverCDP(connectUrl: string): Promise<PlaywrightBrowserHandle>;
}

export interface BrowserbasePlaywrightProviderConfig {
  readonly apiKey: string;
  readonly projectId: string;
  readonly region?: "ap-southeast-1";
  readonly maxSessions?: number;
  readonly sessionTtlMs?: number;
  readonly operationTimeoutMs?: number;
}

interface ActiveSession {
  readonly browser: PlaywrightBrowserHandle;
  readonly page: PlaywrightPageHandle;
  readonly expiresAtMs: number;
  readonly scope: BrowserSessionScope;
}

const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;

export const BROWSERBASE_PLAYWRIGHT_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: true,
  vision: true,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-southeast-1"],
  data_residency: ["SG"],
  batch_support: false,
  maximum_payload: 1_048_576,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const METADATA: ProviderMetadata<"BrowserProvider"> = {
  providerId: "browserbase-playwright",
  interfaceName: "BrowserProvider",
  displayName: "Browserbase + Playwright",
  version: "exec13-v1",
  telemetryNamespace: "alterx.adapters.browserbase.playwright",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "browser-automation-v1",
    rollbackSupported: true,
  },
};

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function realSessionClient(apiKey: string): BrowserbaseSessionClient {
  const client = new Browserbase({ apiKey });
  return {
    create: async (input) => client.sessions.create(input),
  };
}

const REAL_PLAYWRIGHT_CONNECTOR: PlaywrightConnector = {
  connectOverCDP: async (connectUrl) =>
    chromium.connectOverCDP(connectUrl) as unknown as PlaywrightBrowserHandle,
};

export class BrowserbasePlaywrightProvider
  implements BrowserAutomationProvider
{
  readonly metadata = METADATA;
  readonly capabilities = BROWSERBASE_PLAYWRIGHT_CAPABILITIES;

  readonly #projectId: string;
  readonly #region: "ap-southeast-1";
  readonly #maxSessions: number;
  readonly #sessionTtlMs: number;
  readonly #operationTimeoutMs: number;
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #browserbase: BrowserbaseSessionClient;
  readonly #playwright: PlaywrightConnector;
  readonly #urlGuard: Pick<SsrfGuardedFetcher, "assertAllowed">;
  readonly #now: () => Date;

  constructor(
    config: BrowserbasePlaywrightProviderConfig,
    urlGuard: Pick<SsrfGuardedFetcher, "assertAllowed">,
    browserbase?: BrowserbaseSessionClient,
    playwright: PlaywrightConnector = REAL_PLAYWRIGHT_CONNECTOR,
    now: () => Date = () => new Date(),
  ) {
    if (config.apiKey.trim().length === 0) {
      throw new Error("Browserbase API key is required");
    }
    if (config.projectId.trim().length === 0) {
      throw new Error("Browserbase project ID is required");
    }
    this.#projectId = config.projectId;
    this.#region = config.region ?? "ap-southeast-1";
    this.#maxSessions = positiveInteger(
      config.maxSessions ?? DEFAULT_MAX_SESSIONS,
      "Browser session limit",
    );
    this.#sessionTtlMs = positiveInteger(
      config.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
      "Browser session TTL",
    );
    this.#operationTimeoutMs = positiveInteger(
      config.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
      "Browser operation timeout",
    );
    this.#browserbase = browserbase ?? realSessionClient(config.apiKey);
    this.#playwright = playwright;
    this.#urlGuard = urlGuard;
    this.#now = now;
  }

  async createSession(scope: BrowserSessionScope): Promise<BrowserSession> {
    await this.#sweepExpiredSessions();
    const remote = await this.#browserbase.create({
      projectId: this.#projectId,
      region: this.#region,
      userMetadata: {
        tenant_id: scope.tenantId,
        run_id: scope.runId,
        node_execution_id: scope.nodeExecutionId,
        sandbox_session_id: scope.sandboxSessionId,
      },
    });
    const browser = await this.#playwright.connectOverCDP(remote.connectUrl);
    try {
      const context = browser.contexts()[0];
      if (context === undefined) {
        throw new Error("Playwright did not expose a Browserbase context");
      }
      const page = context.pages()[0] ?? (await context.newPage());
      const expiresAtMs = this.#now().getTime() + this.#sessionTtlMs;
      this.#sessions.set(remote.id, { browser, page, expiresAtMs, scope });
      await this.#evictOverflow();
      return {
        sessionId: remote.id,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    } catch (error: unknown) {
      await browser.close();
      throw error;
    }
  }

  async inspectPage(request: BrowserInspectionRequest): Promise<BrowserInspectionResult> {
    await this.#urlGuard.assertAllowed(request.url);
    const remote = await this.#browserbase.create({
      projectId: this.#projectId,
      region: this.#region,
      userMetadata: { verification: "render" },
    });
    const browser = await this.#playwright.connectOverCDP(remote.connectUrl);
    try {
      const context = browser.contexts()[0];
      if (context === undefined) {
        throw new Error("Playwright did not expose a Browserbase context");
      }
      const page = context.pages()[0] ?? (await context.newPage());
      const timeout = request.timeoutMs ?? this.#operationTimeoutMs;
      await page.goto(request.url, { timeout, waitUntil: "domcontentloaded" });
      const text = await page.locator("body").innerText({ timeout });
      return {
        url: page.url(),
        statusCode: 200,
        hasVisibleContent: text.trim().length > 0,
        consoleErrors: [],
      };
    } finally {
      await browser.close();
    }
  }

  async navigate(
    scope: BrowserSessionScope,
    sessionId: string,
    url: string,
  ): Promise<BrowserNavigationResult> {
    const session = await this.#requireSession(scope, sessionId);
    await this.#urlGuard.assertAllowed(url);
    await session.page.goto(url, {
      timeout: this.#operationTimeoutMs,
      waitUntil: "domcontentloaded",
    });
    return { url: session.page.url(), title: await session.page.title() };
  }

  async click(
    scope: BrowserSessionScope,
    sessionId: string,
    selector: string,
  ): Promise<void> {
    if (selector.trim().length === 0) {
      throw new Error("Browser selector is required");
    }
    const session = await this.#requireSession(scope, sessionId);
    await session.page
      .locator(selector)
      .click({ timeout: this.#operationTimeoutMs });
  }

  async extract(
    scope: BrowserSessionScope,
    sessionId: string,
    selector = "body",
  ): Promise<BrowserExtractionResult> {
    if (selector.trim().length === 0) {
      throw new Error("Browser selector is required");
    }
    const session = await this.#requireSession(scope, sessionId);
    const text = await session.page
      .locator(selector)
      .innerText({ timeout: this.#operationTimeoutMs });
    return { text, url: session.page.url() };
  }

  async closeSession(
    scope: BrowserSessionScope,
    sessionId: string,
  ): Promise<void> {
    await this.#sweepExpiredSessions();
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    this.#assertScopeOwnedBy(session, scope);
    this.#sessions.delete(sessionId);
    await session.browser.close();
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: {
        configured: true,
        liveProbe: false,
        activeSessions: this.#sessions.size,
        maxSessions: this.#maxSessions,
      },
    };
  }

  async #requireSession(
    scope: BrowserSessionScope,
    sessionId: string,
  ): Promise<ActiveSession> {
    await this.#sweepExpiredSessions();
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      throw new Error("Browser session was not found or expired");
    }
    this.#assertScopeOwnedBy(session, scope);
    return session;
  }

  #assertScopeOwnedBy(
    session: ActiveSession,
    scope: BrowserSessionScope,
  ): void {
    if (
      session.scope.tenantId !== scope.tenantId ||
      session.scope.runId !== scope.runId ||
      session.scope.nodeExecutionId !== scope.nodeExecutionId ||
      session.scope.sandboxSessionId !== scope.sandboxSessionId
    ) {
      throw new Error("Browser session is not owned by this execution scope");
    }
  }

  async #sweepExpiredSessions(): Promise<void> {
    const nowMs = this.#now().getTime();
    const expired = [...this.#sessions.entries()].filter(
      ([, session]) => session.expiresAtMs <= nowMs,
    );
    await Promise.all(
      expired.map(async ([sessionId, session]) => {
        this.#sessions.delete(sessionId);
        await session.browser.close();
      }),
    );
  }

  async #evictOverflow(): Promise<void> {
    if (this.#sessions.size <= this.#maxSessions) {
      return;
    }
    const oldest = [...this.#sessions.entries()].sort(
      ([, left], [, right]) => left.expiresAtMs - right.expiresAtMs,
    )[0];
    if (oldest !== undefined) {
      this.#sessions.delete(oldest[0]);
      await oldest[1].browser.close();
    }
  }
}
