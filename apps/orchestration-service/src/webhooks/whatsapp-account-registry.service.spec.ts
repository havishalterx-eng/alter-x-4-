import { describe, expect, it, vi } from "vitest";
import { WhatsappAccountRegistryService } from "./whatsapp-account-registry.service";

describe("WhatsappAccountRegistryService", () => {
  it("resolves inbound routing through the narrow database function", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ account_id: "wac_1", tenant_id: "11111111-1111-7111-8111-111111111111", workspace_id: "22222222-2222-7222-8222-222222222222" }] });
    const withTenant = vi.fn();
    const registry = new WhatsappAccountRegistryService({
      withTenant: async <T>(
        tenantId: string,
        operation: (tx: { query: typeof query }) => Promise<T>,
      ): Promise<T> => {
        withTenant(tenantId, operation);
        return operation({ query });
      },
    });

    await expect(registry.resolveInbound("meta-phone-number")).resolves.toEqual({
      accountId: "wac_1", tenantId: "11111111-1111-7111-8111-111111111111", workspaceId: "22222222-2222-7222-8222-222222222222",
    });
    expect(withTenant).toHaveBeenCalledWith("00000000-0000-7000-8000-000000000000", expect.any(Function));
    expect(query).toHaveBeenCalledWith(
      "SELECT account_id, tenant_id, workspace_id FROM resolve_whatsapp_routing($1)",
      ["meta-phone-number"],
    );
  });
});
