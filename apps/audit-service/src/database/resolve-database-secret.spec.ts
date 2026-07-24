import { createMockSecretsProvider } from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";

import { resolveDatabaseConnectionString } from "./resolve-database-secret";

describe("resolveDatabaseConnectionString", () => {
  it("resolves DATABASE_SECRET_REF through SecretsProvider", async () => {
    const reference = "/alter/test/audit/database";
    const provider = createMockSecretsProvider({
      secrets: { [reference]: "postgresql://runtime-resolved/audit_db" },
    });

    await expect(
      resolveDatabaseConnectionString(provider, reference),
    ).resolves.toBe("postgresql://runtime-resolved/audit_db");
  });
});
