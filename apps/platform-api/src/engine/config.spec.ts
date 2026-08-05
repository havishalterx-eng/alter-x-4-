import { describe, expect, it } from "vitest";
import { engineConfigFromEnvironment } from "./config";

describe("engineConfigFromEnvironment", () => {
  it("validates config and applies bounded timeout default", () => {
    expect(
      engineConfigFromEnvironment({
        ENGINE_BASE_URL: "https://engine.test/",
        ADS_CORE_BASE_URL: "https://ads.test/",
        COST_LEDGER_BASE_URL: "https://costs.test/",
        AUDIT_SERVICE_BASE_URL: "https://audit.test/",
        AUDIT_QUERY_SERVICE_TOKEN_REF: "env:AUDIT_QUERY_TOKEN",
        EVAL_SERVICE_GRPC_TARGET: "eval-service:50062",
        ENGINE_M2M_TOKEN_URL: "https://identity.test/oauth/token",
        ENGINE_M2M_AUDIENCE: "https://engine.test",
        ENGINE_M2M_CLIENT_ID: "platform-api",
        ENGINE_M2M_CLIENT_SECRET_REF: "env:ENGINE_SECRET",
      }),
    ).toEqual({
      baseUrl: "https://engine.test",
      adsCoreBaseUrl: "https://ads.test",
      costLedgerBaseUrl: "https://costs.test",
      auditServiceBaseUrl: "https://audit.test",
      auditQueryServiceTokenRef: "env:AUDIT_QUERY_TOKEN",
      evalServiceGrpcTarget: "eval-service:50062",
      m2mTokenUrl: "https://identity.test/oauth/token",
      m2mAudience: "https://engine.test",
      m2mClientId: "platform-api",
      m2mClientSecretRef: "env:ENGINE_SECRET",
      requestTimeoutMs: 5_000,
    });
  });

  it("fails loud when required Engine config is missing", () => {
    expect(() => engineConfigFromEnvironment({})).toThrow(
      "Invalid Engine client environment",
    );
  });
});
