import pg from "pg";
import type { SsoConfig } from "./identity-provider.interface";

export interface SsoConfigStore {
  save(tenantId: string, config: SsoConfig): Promise<void>;
}

export class InMemorySsoConfigStore implements SsoConfigStore {
  private readonly configs = new Map<string, SsoConfig>();

  async save(tenantId: string, config: SsoConfig): Promise<void> {
    this.configs.set(tenantId, config);
  }

  get(tenantId: string): SsoConfig | undefined {
    return this.configs.get(tenantId);
  }
}

export class PgSsoConfigStore implements SsoConfigStore {
  constructor(private readonly pool: pg.Pool) {}

  async save(tenantId: string, config: SsoConfig): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
        tenantId,
      ]);
      const { rowCount } = await client.query(
        `UPDATE tenants SET sso_config = $1 WHERE id = $2`,
        [config, tenantId],
      );
      if (rowCount !== 1) {
        throw new Error("Tenant unavailable for SSO configuration");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function normalizedSsoConfig(config: SsoConfig): SsoConfig {
  if (config.type === "saml") {
    const normalized: SsoConfig = { type: "saml" };
    if (config.metadataUrl) normalized.metadataUrl = config.metadataUrl;
    if (config.entityId) normalized.entityId = config.entityId;
    if (config.certificateRef) normalized.certificateRef = config.certificateRef;
    return normalized;
  }

  const normalized: SsoConfig = {
    type: "oidc",
    issuer: config.issuer,
    clientId: config.clientId,
  };
  if (config.clientSecretRef) normalized.clientSecretRef = config.clientSecretRef;
  return normalized;
}
