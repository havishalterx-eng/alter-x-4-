import { Module } from "@nestjs/common";
import { AwsSecretsManagerProvider } from "@alterx/adapters";
import type { MutableSecretsProvider } from "@alterx/shared-clients";
import { Pool } from "pg";
import { IdempotencyModule } from "../idempotency";
import { CONNECTOR_CATALOG } from "./connectors";
import { createFetchOAuthHttpClient, type OAuthHttpClient } from "./adapters/oauth/oauth-http-client";
import { IntegrationController } from "./integration.controller";
import { IntegrationExceptionFilter } from "./integration-exception.filter";
import { IntegrationRepository } from "./integration.repository";
import {
  IntegrationService,
  type ConnectorRuntimeConfigMap,
} from "./integration.service";
import {
  INTEGRATION_CONNECTOR_RUNTIME_CONFIG,
  INTEGRATION_OAUTH_HTTP_CLIENT,
  INTEGRATION_SECRETS_PROVIDER,
} from "./tokens";

function buildConnectorRuntimeConfig(): ConnectorRuntimeConfigMap {
  const envRefs: Record<string, [string, string]> = {
    github: [
      "GITHUB_OAUTH_CLIENT_ID_SECRET_REF",
      "GITHUB_OAUTH_CLIENT_SECRET_REF",
    ],
    google: [
      "GOOGLE_OAUTH_CLIENT_ID_SECRET_REF",
      "GOOGLE_OAUTH_CLIENT_SECRET_REF",
    ],
    slack: [
      "SLACK_OAUTH_CLIENT_ID_SECRET_REF",
      "SLACK_OAUTH_CLIENT_SECRET_REF",
    ],
    hubspot: [
      "HUBSPOT_OAUTH_CLIENT_ID_SECRET_REF",
      "HUBSPOT_OAUTH_CLIENT_SECRET_REF",
    ],
    linkedin: [
      "LINKEDIN_OAUTH_CLIENT_ID_SECRET_REF",
      "LINKEDIN_OAUTH_CLIENT_SECRET_REF",
    ],
  };
  const config: Record<string, unknown> = {};
  for (const connector of CONNECTOR_CATALOG) {
    const [clientIdEnvVar, clientSecretEnvVar] = envRefs[connector.id]!;
    const clientIdEnvValue = process.env[clientIdEnvVar];
    const clientSecretEnvValue = process.env[clientSecretEnvVar];
    config[connector.id] = {
      clientIdSecretRef: clientIdEnvValue ?? connector.defaultClientIdSecretRef,
      clientSecretSecretRef:
        clientSecretEnvValue ?? connector.defaultClientSecretSecretRef,
      configured: Boolean(clientIdEnvValue) && Boolean(clientSecretEnvValue),
    };
  }
  return config as ConnectorRuntimeConfigMap;
}

@Module({
  imports: [IdempotencyModule],
  controllers: [IntegrationController],
  providers: [
    {
      provide: IntegrationRepository,
      useFactory: () =>
        new IntegrationRepository(
          new Pool({ connectionString: process.env.DATABASE_URL }),
          true,
        ),
    },
    {
      provide: INTEGRATION_SECRETS_PROVIDER,
      useFactory: () =>
        new AwsSecretsManagerProvider({
          region: process.env.AWS_REGION ?? "ap-south-1",
        }),
    },
    {
      provide: INTEGRATION_OAUTH_HTTP_CLIENT,
      useFactory: () => createFetchOAuthHttpClient(),
    },
    {
      provide: INTEGRATION_CONNECTOR_RUNTIME_CONFIG,
      useFactory: () => buildConnectorRuntimeConfig(),
    },
    {
      provide: IntegrationService,
      inject: [
        IntegrationRepository,
        INTEGRATION_SECRETS_PROVIDER,
        INTEGRATION_OAUTH_HTTP_CLIENT,
        INTEGRATION_CONNECTOR_RUNTIME_CONFIG,
      ],
      useFactory: (
        repository: IntegrationRepository,
        secrets: MutableSecretsProvider,
        http: OAuthHttpClient,
        connectorConfig: ConnectorRuntimeConfigMap,
      ) =>
        new IntegrationService(
          repository,
          secrets,
          http,
          connectorConfig,
          Number(process.env.OAUTH_STATE_TTL_SECONDS ?? 300),
        ),
    },
    IntegrationExceptionFilter,
  ],
  exports: [IntegrationService],
})
export class IntegrationModule {}
