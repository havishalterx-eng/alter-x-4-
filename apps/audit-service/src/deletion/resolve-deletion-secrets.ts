import type { SecretsProvider } from "@alterx/shared-clients";

export interface ResolvedDeletionSecrets {
  readonly serviceToken: string;
  readonly pseudonymKey: string;
}

export async function resolveDeletionSecrets(
  secrets: SecretsProvider,
  references: {
    readonly serviceTokenReference: string;
    readonly pseudonymKeyReference: string;
  },
): Promise<ResolvedDeletionSecrets> {
  const [serviceToken, pseudonymKey] = await Promise.all([
    secrets.getSecret(references.serviceTokenReference),
    secrets.getSecret(references.pseudonymKeyReference),
  ]);
  if (serviceToken.length === 0) throw new Error("Deletion service token resolved empty");
  if (pseudonymKey.length < 32) throw new Error("Deletion pseudonym key resolved too short");
  return { serviceToken, pseudonymKey };
}
