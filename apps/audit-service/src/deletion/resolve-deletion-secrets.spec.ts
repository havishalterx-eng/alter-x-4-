import { createMockSecretsProvider } from "@alterx/shared-clients";
import type { SecretsProvider } from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";

import { resolveDeletionSecrets } from "./resolve-deletion-secrets";

describe("resolveDeletionSecrets", () => {
  it("resolves both values exclusively through reference IDs", async () => {
    const serviceTokenReference = "/alter/prod/audit-service/system/deletion-service-token";
    const pseudonymKeyReference = "/alter/prod/audit-service/system/deletion-pseudonym-key";
    const base = createMockSecretsProvider({
      secrets: {
        [serviceTokenReference]: "resolved-service-token",
        [pseudonymKeyReference]: "resolved-pseudonym-key-material-over-thirty-two-characters",
      },
    });
    const calls: string[] = [];
    const secrets: SecretsProvider = {
      ...base,
      async getSecret(referenceId) {
        calls.push(referenceId);
        return base.getSecret(referenceId);
      },
    };

    await expect(resolveDeletionSecrets(secrets, {
      serviceTokenReference,
      pseudonymKeyReference,
    })).resolves.toEqual({
      serviceToken: "resolved-service-token",
      pseudonymKey: "resolved-pseudonym-key-material-over-thirty-two-characters",
    });
    expect(calls).toEqual([serviceTokenReference, pseudonymKeyReference]);
  });

  it("fails startup when either referenced value cannot be resolved safely", async () => {
    const secrets = createMockSecretsProvider({
      secrets: { token: "service-token", weak: "too-short" },
    });
    await expect(resolveDeletionSecrets(secrets, {
      serviceTokenReference: "token",
      pseudonymKeyReference: "weak",
    })).rejects.toThrow("too short");

    const emptyToken = createMockSecretsProvider({
      secrets: { empty: "", strong: "pseudonym-key-material-that-is-long-enough" },
    });
    await expect(resolveDeletionSecrets(emptyToken, {
      serviceTokenReference: "empty",
      pseudonymKeyReference: "strong",
    })).rejects.toThrow("service token resolved empty");
  });
});
