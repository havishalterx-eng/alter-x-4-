import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  EmailProvider,
  EmailSendResult,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

export interface SesEmailProviderConfig {
  readonly region: string;
  readonly fromAddress: string;
  readonly credentialsSecretRef: string;
}

export interface SesCommandClient {
  send(command: SendEmailCommand): Promise<{ readonly MessageId?: string }>;
  destroy?(): void;
}

export type SecretResolver = (reference: string) => Promise<string>;

export const SES_EMAIL_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: true,
  maximum_payload: 10_485_760,
  supported_languages: [],
  cost_model: { rates: [] },
};

const SES_EMAIL_METADATA: ProviderMetadata<"EmailProvider"> = {
  providerId: "aws-ses",
  interfaceName: "EmailProvider",
  displayName: "AWS SES",
  version: "ses-v2",
  telemetryNamespace: "alterx.adapters.ses",
  supportsTenantOverrides: false,
  migration: { strategyVersion: "aws-ses-v2", rollbackSupported: true },
};

interface SesCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export class SesEmailProvider implements EmailProvider {
  readonly metadata = SES_EMAIL_METADATA;
  readonly capabilities = SES_EMAIL_CAPABILITIES;

  readonly #config: SesEmailProviderConfig;
  readonly #resolveSecret: SecretResolver;
  readonly #now: () => Date;
  #client: SesCommandClient | undefined;

  constructor(
    config: SesEmailProviderConfig,
    resolveSecret: SecretResolver,
    client?: SesCommandClient,
    now?: () => Date,
  ) {
    this.#config = config;
    this.#resolveSecret = resolveSecret;
    this.#client = client;
    this.#now = now ?? (() => new Date());
  }

  async sendTemplatedEmail(
    to: string,
    templateId: string,
    variables: Record<string, string>,
    locale?: string,
  ): Promise<EmailSendResult> {
    const response = await (await this.#getClient()).send(
      new SendEmailCommand({
        FromEmailAddress: this.#config.fromAddress,
        Destination: { ToAddresses: [to] },
        Content: {
          Template: {
            TemplateName: locale ? `${templateId}-${locale}` : templateId,
            TemplateData: JSON.stringify(variables),
          },
        },
      }),
    );
    if (!response.MessageId) {
      throw new Error("SES did not return a message ID");
    }
    return { messageId: response.MessageId, acceptedAt: this.#now().toISOString() };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: { configured: true },
    };
  }

  close(): void {
    this.#client?.destroy?.();
  }

  async #getClient(): Promise<SesCommandClient> {
    if (this.#client) return this.#client;
    const credentials = parseCredentials(
      await this.#resolveSecret(this.#config.credentialsSecretRef),
    );
    this.#client = new SESv2Client({
      region: this.#config.region,
      credentials,
    }) as unknown as SesCommandClient;
    return this.#client;
  }
}

function parseCredentials(value: string): SesCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("SES credentials secret must be JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("SES credentials secret is invalid");
  }
  const record = parsed as Record<string, unknown>;
  const accessKeyId = record.accessKeyId;
  const secretAccessKey = record.secretAccessKey;
  if (typeof accessKeyId !== "string" || typeof secretAccessKey !== "string") {
    throw new Error("SES credentials secret is invalid");
  }
  const sessionToken = record.sessionToken;
  if (sessionToken !== undefined && typeof sessionToken !== "string") {
    throw new Error("SES credentials secret is invalid");
  }
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken === undefined ? {} : { sessionToken }),
  };
}
