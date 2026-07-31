import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export interface BackupRestoreTarget {
  readonly resourceArn: string;
  readonly restoreClusterIdentifier: string;
  readonly restoreMetadata: Record<string, string>;
  readonly restoreInstanceIdentifier: string;
  readonly restoreInstanceClass: string;
  readonly restoreInstanceEngine: string;
}

export interface BackupRestoreDrillConfig {
  readonly region: string;
  readonly vaultName: string;
  readonly backupRoleArn: string;
  readonly targets: readonly BackupRestoreTarget[];
  readonly restoredAuditServiceUrl: string;
  readonly deletionServiceToken: string;
  readonly replaySince: string;
  readonly evidencePath: string;
}

interface DrillEvidence {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly targets: readonly {
    resourceArn: string;
    backupJobId: string;
    recoveryPointArn: string;
    restoreJobId: string;
    restoreClusterIdentifier: string;
    restoreInstanceIdentifier: string;
  }[];
  readonly restoredAuditService: { readonly healthy: boolean; readonly replay: unknown };
}

/** Loads the explicit operator inputs required for a real AWS Backup restore drill. */
export function loadBackupRestoreDrillConfig(environment: NodeJS.ProcessEnv): BackupRestoreDrillConfig {
  const required = (name: string): string => {
    const value = environment[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  let targets: unknown;
  try {
    targets = JSON.parse(required("BACKUP_DRILL_TARGETS_JSON"));
  } catch {
    throw new Error("BACKUP_DRILL_TARGETS_JSON must be valid JSON");
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("BACKUP_DRILL_TARGETS_JSON must contain at least one target");
  }
  const parsedTargets = targets.map((target, index) => parseTarget(target, index));
  const replaySince = required("DELETION_REPLAY_SINCE");
  if (Number.isNaN(new Date(replaySince).getTime())) {
    throw new Error("DELETION_REPLAY_SINCE must be ISO 8601");
  }
  return {
    region: required("AWS_REGION"),
    vaultName: required("BACKUP_VAULT_NAME"),
    backupRoleArn: required("BACKUP_ROLE_ARN"),
    targets: parsedTargets,
    restoredAuditServiceUrl: required("RESTORED_AUDIT_SERVICE_URL").replace(/\/$/, ""),
    deletionServiceToken: required("DELETION_SERVICE_TOKEN"),
    replaySince,
    evidencePath: environment.BACKUP_DRILL_EVIDENCE_PATH ?? resolve("artifacts", "backup-restore-drill.json"),
  };
}

export async function runBackupRestoreDrill(config: BackupRestoreDrillConfig): Promise<DrillEvidence> {
  const startedAt = new Date().toISOString();
  const targets: Array<DrillEvidence["targets"][number]> = [];
  for (const target of config.targets) {
    const backup = await awsJson(config.region, ["backup", "start-backup-job", "--backup-vault-name", config.vaultName, "--resource-arn", target.resourceArn, "--iam-role-arn", config.backupRoleArn]);
    const backupJobId = requiredString(backup, "BackupJobId");
    const completedBackup = await waitForJob(config.region, "backup", backupJobId);
    const recoveryPointArn = requiredString(completedBackup, "RecoveryPointArn");
    const restore = await awsJson(config.region, ["backup", "start-restore-job", "--recovery-point-arn", recoveryPointArn, "--resource-type", "Aurora", "--iam-role-arn", config.backupRoleArn, "--metadata", JSON.stringify(target.restoreMetadata)]);
    const restoreJobId = requiredString(restore, "RestoreJobId");
    await waitForJob(config.region, "restore", restoreJobId);
    await aws(config.region, ["rds", "wait", "db-cluster-available", "--db-cluster-identifier", target.restoreClusterIdentifier]);
    await aws(config.region, ["rds", "create-db-instance", "--db-instance-identifier", target.restoreInstanceIdentifier, "--db-cluster-identifier", target.restoreClusterIdentifier, "--db-instance-class", target.restoreInstanceClass, "--engine", target.restoreInstanceEngine]);
    await aws(config.region, ["rds", "wait", "db-instance-available", "--db-instance-identifier", target.restoreInstanceIdentifier]);
    targets.push({ resourceArn: target.resourceArn, backupJobId, recoveryPointArn, restoreJobId, restoreClusterIdentifier: target.restoreClusterIdentifier, restoreInstanceIdentifier: target.restoreInstanceIdentifier });
  }
  const health = await fetch(`${config.restoredAuditServiceUrl}/health`);
  if (!health.ok) throw new Error(`Restored audit service health check failed with status ${health.status}`);
  const replayResponse = await fetch(`${config.restoredAuditServiceUrl}/internal/deletion/replay`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.deletionServiceToken}`, "content-type": "application/json" },
    body: JSON.stringify({ sinceTimestamp: config.replaySince }),
  });
  if (!replayResponse.ok) throw new Error(`Deletion-ledger replay failed with status ${replayResponse.status}`);
  const evidence: DrillEvidence = { startedAt, completedAt: new Date().toISOString(), targets, restoredAuditService: { healthy: true, replay: await replayResponse.json() } };
  await mkdir(dirname(config.evidencePath), { recursive: true });
  await writeFile(config.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidence;
}

function parseTarget(value: unknown, index: number): BackupRestoreTarget {
  if (!value || typeof value !== "object") throw new Error(`BACKUP_DRILL_TARGETS_JSON[${index}] must be an object`);
  const target = value as Record<string, unknown>;
  const string = (name: string): string => {
    const candidate = target[name];
    if (typeof candidate !== "string" || candidate.length === 0) throw new Error(`BACKUP_DRILL_TARGETS_JSON[${index}].${name} must be a non-empty string`);
    return candidate;
  };
  const metadata = target.restoreMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || Object.values(metadata).some((item) => typeof item !== "string")) {
    throw new Error(`BACKUP_DRILL_TARGETS_JSON[${index}].restoreMetadata must be a string map`);
  }
  const restoreMetadata = metadata as Record<string, string>;
  if (restoreMetadata.DBClusterIdentifier !== string("restoreClusterIdentifier") || !restoreMetadata.Engine) {
    throw new Error(`BACKUP_DRILL_TARGETS_JSON[${index}].restoreMetadata must contain matching DBClusterIdentifier and Engine`);
  }
  if (!restoreMetadata.UseLatestRestorableTime && !restoreMetadata.RestoreToTime) {
    throw new Error(`BACKUP_DRILL_TARGETS_JSON[${index}].restoreMetadata must contain UseLatestRestorableTime or RestoreToTime`);
  }
  return { resourceArn: string("resourceArn"), restoreClusterIdentifier: string("restoreClusterIdentifier"), restoreMetadata, restoreInstanceIdentifier: string("restoreInstanceIdentifier"), restoreInstanceClass: string("restoreInstanceClass"), restoreInstanceEngine: string("restoreInstanceEngine") };
}

async function waitForJob(region: string, kind: "backup" | "restore", id: string): Promise<Record<string, unknown>> {
  const command = kind === "backup" ? "describe-backup-job" : "describe-restore-job";
  const idFlag = kind === "backup" ? "--backup-job-id" : "--restore-job-id";
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const job = await awsJson(region, ["backup", command, idFlag, id]);
    const state = requiredString(job, "State");
    if (state === "COMPLETED") return job;
    if (["ABORTED", "EXPIRED", "FAILED"].includes(state)) throw new Error(`${kind} job ${id} ended in ${state}`);
    await new Promise((done) => setTimeout(done, 10_000));
  }
  throw new Error(`${kind} job ${id} did not complete within 30 minutes`);
}

async function aws(region: string, args: readonly string[]): Promise<void> {
  await execFile("aws", ["--region", region, ...args], { maxBuffer: 1024 * 1024 });
}

async function awsJson(region: string, args: readonly string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFile("aws", ["--region", region, ...args, "--output", "json"], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`AWS response missing ${name}`);
  return value;
}

if (require.main === module) {
  void runBackupRestoreDrill(loadBackupRestoreDrillConfig(process.env));
}
