import type { Pool } from "pg";
import { z } from "zod";

/**
 * tenants.data_residency -- "pinning + legal basis" in docs/specs/04-data-model.md,
 * which gave it no shape. This is that shape: the residency codes the tenant's
 * data may be processed in, and why. Null means the tenant pins nothing.
 */
export const TenantDataResidencySchema = z
  .object({
    allowed: z.array(z.string().trim().min(1)).min(1).max(32),
    legal_basis: z.string().trim().min(1).optional(),
  })
  .strict();

export class TenantDataResidencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantDataResidencyError";
  }
}

/**
 * Residency is tenant-owned (docs/specs/03-tech-spec-architecture.md), so it is
 * read from the tenant record on every plan and never taken from a request.
 */
export class TenantResidencyRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * The tenant's allowed data residency, or [] when it pins none.
   *
   * Fails closed: a missing tenant or a value that does not match the schema
   * throws rather than planning as if the tenant were unconstrained.
   */
  async allowedDataResidency(tenantId: string): Promise<string[]> {
    const bareTenantId = tenantId.startsWith("ten_") ? tenantId.slice("ten_".length) : tenantId;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // tenants is FORCE RLS; the read only sees the row for this tenant.
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [bareTenantId]);
      const result = await client.query<{ data_residency: unknown }>(
        "SELECT data_residency FROM tenants WHERE id = $1",
        [bareTenantId],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      if (row === undefined) throw new TenantDataResidencyError("tenant not found");
      if (row.data_residency === null) return [];
      const parsed = TenantDataResidencySchema.safeParse(row.data_residency);
      if (!parsed.success) {
        throw new TenantDataResidencyError(
          `tenant data_residency is malformed: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        );
      }
      return parsed.data.allowed;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
