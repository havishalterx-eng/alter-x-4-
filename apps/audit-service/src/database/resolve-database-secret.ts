import type { SecretsProvider } from "@alterx/shared-clients";

export async function resolveDatabaseConnectionString(
  secretsProvider: SecretsProvider,
  databaseSecretReference: string,
): Promise<string> {
  return secretsProvider.getSecret(databaseSecretReference);
}
