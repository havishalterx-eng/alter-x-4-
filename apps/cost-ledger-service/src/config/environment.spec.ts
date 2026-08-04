import { describe, expect, it } from "vitest";

import {
  CostLedgerConfigurationError,
  loadCostLedgerEnvironment,
} from "./environment";

const baseEnvironment = {
  ALTER_ENV: "local",
  ALTER_SERVICE_NAME: "cost-ledger-service",
  DATABASE_SECRET_REF: "secret://cost-ledger/local",
  COST_PSEUDONYM_KEY_REF: "secret://cost-ledger/pseudonym",
};

describe("loadCostLedgerEnvironment", () => {
  it("uses the disclosed INR conversion placeholder for new cost ingestion", () => {
    expect(loadCostLedgerEnvironment(baseEnvironment).costUsdToInrRate).toBe(83);
    expect(
      loadCostLedgerEnvironment({
        ...baseEnvironment,
        COST_USD_TO_INR_RATE: "84.25",
      }).costUsdToInrRate,
    ).toBe(84.25);
  });

  it("fails startup for an invalid INR conversion rate", () => {
    expect(() =>
      loadCostLedgerEnvironment({
        ...baseEnvironment,
        COST_USD_TO_INR_RATE: "0",
      }),
    ).toThrow(CostLedgerConfigurationError);
  });
});
