# Backup And Restore Drill

Run this only in an isolated AWS environment. It creates a real on-demand AWS Backup recovery point, restores each declared Aurora cluster under a new identifier, creates a writer instance, checks the restored audit service, and replays the persisted deletion ledger.

The restored audit service must be deployed against the restored ADS and control-plane clusters before the command runs. The runner does not delete restored resources; record and approve cleanup separately.

```bash
export AWS_REGION=ap-south-1
export BACKUP_VAULT_NAME=alter-staging-data
export BACKUP_ROLE_ARN=arn:aws:iam::<account>:role/<aws-backup-role>
export DELETION_REPLAY_SINCE=2026-07-01T00:00:00.000Z
export RESTORED_AUDIT_SERVICE_URL=https://audit.restore.example
export DELETION_SERVICE_TOKEN=<internal-deletion-token>
export BACKUP_DRILL_TARGETS_JSON='[{"resourceArn":"arn:aws:rds:...:cluster:alter-staging-ads","restoreClusterIdentifier":"alter-drill-ads","restoreMetadata":{"DBClusterIdentifier":"alter-drill-ads","Engine":"aurora-postgresql","UseLatestRestorableTime":"true"},"restoreInstanceIdentifier":"alter-drill-ads-writer","restoreInstanceClass":"db.serverless","restoreInstanceEngine":"aurora-postgresql"}]'
pnpm exec nx run audit-service:backup-restore-drill
```

The runner writes redacted evidence to `artifacts/backup-restore-drill.json`. Archive that evidence with the AWS Backup job IDs and restore job IDs. Do not commit tokens, database URLs, or account-specific target values.
