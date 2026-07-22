import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ProviderMetadata,
  SecretsProvider,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_SECRETS_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(65_536);

export class InvalidSecretReferenceError extends Error {
  public constructor() {
    super("Secret reference ID must be non-empty and contain no whitespace");
    this.name = "InvalidSecretReferenceError";
  }
}

export class SecretNotFoundError extends Error {
  public readonly referenceId: string;

  public constructor(referenceId: string) {
    super(`Secret reference was not found: ${referenceId}`);
    this.name = "SecretNotFoundError";
    this.referenceId = referenceId;
  }
}

export interface MockSecretsProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"SecretsProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly secrets?: Readonly<Record<string, string>>;
}

const DEFAULT_SECRETS = Object.freeze({
  "contract/secret": "contract-secret-value",
});

export function createMockSecretsProvider(
  options: MockSecretsProviderOptions = {},
): SecretsProvider {
  const providerId = options.providerId ?? "mock.secrets";
  const secrets = new Map(
    Object.entries(options.secrets ?? DEFAULT_SECRETS),
  );

  return createMockProvider<SecretsProvider>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "SecretsProvider"),
    capabilities: options.capabilities ?? MOCK_SECRETS_CAPABILITIES,
    implementation: {
      getSecret: async (referenceId) => {
        if (
          referenceId.length === 0 ||
          referenceId.trim() !== referenceId ||
          /\s/.test(referenceId)
        ) {
          throw new InvalidSecretReferenceError();
        }

        const secret = secrets.get(referenceId);
        if (secret === undefined) {
          throw new SecretNotFoundError(referenceId);
        }

        return secret;
      },
    },
  });
}
