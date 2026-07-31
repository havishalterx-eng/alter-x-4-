import { describe, expect, it } from "vitest";
import { loadBackupRestoreDrillConfig } from "./backup-restore-drill";

const target = {
  resourceArn: "arn:aws:rds:ap-south-1:123456789012:cluster:alter-staging-ads",
  restoreClusterIdentifier: "alter-drill-ads",
  restoreMetadata: { DBClusterIdentifier: "alter-drill-ads", Engine: "aurora-postgresql", UseLatestRestorableTime: "true" },
  restoreInstanceIdentifier: "alter-drill-ads-writer",
  restoreInstanceClass: "db.serverless",
  restoreInstanceEngine: "aurora-postgresql",
};

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    AWS_REGION: "ap-south-1", BACKUP_VAULT_NAME: "alter-staging-data", BACKUP_ROLE_ARN: "arn:aws:iam::123456789012:role/AWSBackupRole",
    BACKUP_DRILL_TARGETS_JSON: JSON.stringify([target]), RESTORED_AUDIT_SERVICE_URL: "https://audit.restore.example/",
    DELETION_SERVICE_TOKEN: "not-recorded-in-evidence", DELETION_REPLAY_SINCE: "2026-07-01T00:00:00.000Z", ...overrides,
  };
}

describe("HARD-10 backup/restore drill configuration", () => {
  it("requires explicit Aurora restore and replay inputs", () => {
    expect(loadBackupRestoreDrillConfig(environment())).toMatchObject({
      restoredAuditServiceUrl: "https://audit.restore.example", replaySince: "2026-07-01T00:00:00.000Z", targets: [target],
    });
  });

  it("rejects restore metadata that does not name the isolated target", () => {
    const invalid = { ...target, restoreMetadata: { ...target.restoreMetadata, DBClusterIdentifier: "source-cluster" } };
    expect(() => loadBackupRestoreDrillConfig(environment({ BACKUP_DRILL_TARGETS_JSON: JSON.stringify([invalid]) }))).toThrow("matching DBClusterIdentifier");
  });

  it("requires an explicit recovery-point time selection", () => {
    const invalid = { ...target, restoreMetadata: { DBClusterIdentifier: target.restoreClusterIdentifier, Engine: "aurora-postgresql" } };
    expect(() => loadBackupRestoreDrillConfig(environment({ BACKUP_DRILL_TARGETS_JSON: JSON.stringify([invalid]) }))).toThrow("UseLatestRestorableTime");
  });

  it("rejects an invalid deletion-ledger replay boundary", () => {
    expect(() => loadBackupRestoreDrillConfig(environment({ DELETION_REPLAY_SINCE: "tomorrowish" }))).toThrow("ISO 8601");
  });
});
