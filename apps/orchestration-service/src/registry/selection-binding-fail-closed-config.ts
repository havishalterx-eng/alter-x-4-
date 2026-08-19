import type { ParameterStoreProvider } from "@alterx/shared-clients";

/**
 * Live, no-redeploy kill switch for the fail-closed path in Nodeexec's
 * agent-binding resolution (see #resolveAgentBindingBestEffort). Default
 * OFF (fail-open, today's behavior) whenever the parameter doesn't exist
 * -- turning this on is a deliberate operator action, never an accident
 * of an unset environment. Re-reads on every check (same convention
 * model-gateway's OperationalConfigProvider uses for its own live policy
 * overrides) rather than caching, so a value written by an operator takes
 * effect on the very next node execution, no restart needed.
 */
export interface SelectionBindingFailClosedConfig {
  isEnabled(): Promise<boolean>;
}

export class SsmSelectionBindingFailClosedConfig implements SelectionBindingFailClosedConfig {
  constructor(
    private readonly store: ParameterStoreProvider,
    private readonly parameterName: string,
  ) {}

  async isEnabled(): Promise<boolean> {
    try {
      const raw = await this.store.getParameter(this.parameterName);
      return raw.trim().toLowerCase() === "true";
    } catch {
      return false;
    }
  }
}
