import { describe, expect, it } from "vitest";

import { AuditConfigurationError, loadAuditEnvironment } from "./environment";

function environment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ALTER_ENV: "local",
    ALTER_SERVICE_NAME: "audit-service",
    ALTER_REGION: "ap-south-1",
    ALTER_CONFIG_SOURCE: "local-file",
    DATABASE_SECRET_REF: "/alter/local/audit-service/system/database_credentials",
    AUDIT_ARCHIVE_BUCKET_PARAM: "/alter/local/audit/archive-bucket",
    ...overrides,
  };
}

describe("loadAuditEnvironment", () => {
  it("validates and returns the documented audit-service environment", () => {
    expect(loadAuditEnvironment(environment())).toEqual({
      alterEnvironment: "local",
      serviceName: "audit-service",
      region: "ap-south-1",
      configSource: "local-file",
      databaseAuthentication: "static",
      databaseSecretReference:
        "/alter/local/audit-service/system/database_credentials",
      auditArchiveBucketParameter: "/alter/local/audit/archive-bucket",
      httpPort: 3000,
      grpcBindAddress: "0.0.0.0:50051",
    });
  });

  it.each([undefined, "test", "development"])(
    "allows local static authentication when NODE_ENV is %s",
    (nodeEnvironment) => {
      expect(
        loadAuditEnvironment(environment({ NODE_ENV: nodeEnvironment })),
      ).toMatchObject({ databaseAuthentication: "static" });
    },
  );

  it("rejects local static authentication when NODE_ENV is production", () => {
    expect(() =>
      loadAuditEnvironment(environment({ NODE_ENV: "production" })),
    ).toThrow(AuditConfigurationError);
    expect(() =>
      loadAuditEnvironment(environment({ NODE_ENV: "production" })),
    ).toThrow(/static database authentication/);
  });

  it("accepts validated custom bind ports", () => {
    expect(
      loadAuditEnvironment(
        environment({ PORT: "3100", GRPC_BIND_ADDRESS: "127.0.0.1:51051" }),
      ),
    ).toMatchObject({ httpPort: 3100, grpcBindAddress: "127.0.0.1:51051" });
  });

  it("defaults deployed environments to IAM database authentication metadata", () => {
    expect(
      loadAuditEnvironment(
        environment({
          ALTER_ENV: "prod",
          ALTER_CONFIG_SOURCE: "appconfig",
          DATABASE_SECRET_REF: undefined,
          DATABASE_HOST:
            "alter-prod-data.cluster-example.ap-south-1.rds.amazonaws.com",
          DATABASE_PORT: "5432",
          DATABASE_NAME: "audit_db",
          DATABASE_USER: "audit_service",
        }),
      ),
    ).toMatchObject({
      databaseAuthentication: "iam",
      databaseHost:
        "alter-prod-data.cluster-example.ap-south-1.rds.amazonaws.com",
      databasePort: 5432,
      databaseName: "audit_db",
      databaseUser: "audit_service",
    });
  });

  it.each([
    ["ALTER_ENV", { ALTER_ENV: "qa" }],
    ["ALTER_SERVICE_NAME", { ALTER_SERVICE_NAME: "audit" }],
    ["ALTER_REGION", { ALTER_REGION: "us-east-1" }],
    ["ALTER_CONFIG_SOURCE", { ALTER_CONFIG_SOURCE: "environment" }],
    ["DATABASE_SECRET_REF", { DATABASE_SECRET_REF: "" }],
    ["AUDIT_ARCHIVE_BUCKET_PARAM", { AUDIT_ARCHIVE_BUCKET_PARAM: "" }],
    ["PORT", { PORT: "0" }],
    ["GRPC_BIND_ADDRESS", { GRPC_BIND_ADDRESS: "localhost:50051" }],
    ["GRPC_BIND_ADDRESS", { GRPC_BIND_ADDRESS: "127.0.0.1:70000" }],
    [
      "DATABASE_HOST",
      {
        ALTER_ENV: "dev",
        DATABASE_HOST: "",
        DATABASE_PORT: "5432",
        DATABASE_NAME: "audit_db",
        DATABASE_USER: "audit_service",
      },
    ],
    [
      "DATABASE_PORT",
      {
        ALTER_ENV: "dev",
        DATABASE_HOST: "db.internal",
        DATABASE_PORT: "0",
        DATABASE_NAME: "audit_db",
        DATABASE_USER: "audit_service",
      },
    ],
    [
      "DATABASE_NAME",
      {
        ALTER_ENV: "dev",
        DATABASE_HOST: "db.internal",
        DATABASE_PORT: "5432",
        DATABASE_NAME: "",
        DATABASE_USER: "audit_service",
      },
    ],
    [
      "DATABASE_USER",
      {
        ALTER_ENV: "dev",
        DATABASE_HOST: "db.internal",
        DATABASE_PORT: "5432",
        DATABASE_NAME: "audit_db",
        DATABASE_USER: "",
      },
    ],
  ])("rejects invalid %s", (field, override) => {
    expect(() => loadAuditEnvironment(environment(override))).toThrow(
      AuditConfigurationError,
    );
    expect(() => loadAuditEnvironment(environment(override))).toThrow(field);
  });

  it("does not read a raw DATABASE_URL credential from environment", () => {
    const loaded = loadAuditEnvironment(
      environment({ DATABASE_URL: "postgresql://raw-credential.invalid/audit" }),
    );
    expect(loaded).not.toHaveProperty("databaseUrl");
  });
});
