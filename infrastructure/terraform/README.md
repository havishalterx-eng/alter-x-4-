# Alter AWS landing zone

This directory defines the real AWS Organizations and per-account foundation for Alter. It is intentionally unapplied: no AWS management account exists yet, and every account ID, account email, role ARN, OU target, region, budget, and network range enters through variables or example-only placeholder files.

## Prerequisites and deployment order

AWS Control Tower landing-zone enablement is a one-time management-account console/API action. It must be completed first in `ap-south-1`, including IAM Identity Center and the log-archive/security accounts. This repository does not invent a Terraform resource for that prerequisite or modify Control Tower-managed resources.

Deployment is deliberately two-stage:

1. Copy `terraform.tfvars.example` to ignored `terraform.tfvars`, replace every placeholder, and run the root management stack. Its declarative imports adopt `alter-management`, `alter-log-archive`, and `alter-security`; it creates the remaining member accounts and attaches SCPs to registered OUs or explicit accounts.
2. For each account, copy its `environments/<name>/terraform.tfvars.example` to ignored `terraform.tfvars`, replace placeholders, and run that account stack. The provider assumes the supplied bootstrap role into the already-existing account before creating its KMS key, budget, CI role, and optional VPC.

Never use `terraform apply` until the management account, Control Tower landing zone, registered OUs, remote state, and reviewed real variable files exist.

## Design decisions

- **Module boundaries:** `account` owns one Organizations account, `scp` owns one policy and its attachments, `network` owns one Multi-AZ VPC, and `environment` owns the per-account KMS key, budget, bounded CI role, and optional network. Root and the eight `environments/*` directories are separate state boundaries because Terraform cannot safely create an account and configure a provider inside it in one plan.
- **Networks:** management, log-archive, and security intentionally have no application VPC. Shared-services, dev, staging, prod, and sandbox-exec have non-overlapping example CIDRs (`10.10.0.0/16` through `10.50.0.0/16`) and public/private subnets across `ap-south-1a` and `ap-south-1b`. The root CIDR catalog fails validation if any ranges overlap and must be updated alongside environment inputs. Public subnets do not auto-assign public IPs. VPC flow logs are KMS-encrypted and retained for 365 days.
- **NAT:** dev and staging use one NAT gateway to limit baseline cost. Shared-services, production, and sandbox-exec use one NAT gateway per AZ for availability or isolation. Production validates `per_az` explicitly. A later FinOps review can change these variable values without changing module code.
- **SCP grouping:** baseline regional, audit, and root-user policies attach to all registered member OUs. Production separately denies long-lived IAM credentials and KMS key disable/deletion outside audited break-glass roles. Sandbox separately denies VPC peering, transit peering, and RAM sharing. Global services are excluded from the regional deny through `NotAction`; workloads remain restricted to `ap-south-1`.
- **KMS:** every one of the eight account stacks creates its own rotating, single-region customer-managed key. Its policy names only that account root plus the regional CloudWatch Logs service under the account's `/alter/*` encryption context; no cross-account grant exists.
- **Budgets:** limits are inputs, not module defaults. Example planning values are USD 100 management, 200 log archive, 300 security/shared services/sandbox, 200 dev, 500 staging, and 2,000 production. All alert at forecast 80% and 100%, with production additionally alerting at 70% and 85%. Owners must approve replacements before apply.
- **CI roles:** shared-services and all workload accounts define `alter-ci-deployment`, trusted only by the supplied shared-services CI principal plus external ID. The role and permission boundary share exact action/resource lists; only `ecr:GetAuthorizationToken` and `ecs:RegisterTaskDefinition`, which AWS requires to use `Resource = "*"`, are globally allowlisted. No long-lived access keys are created.
- **Identity Center:** Control Tower owns initial IAM Identity Center enablement and human directory setup. Permission sets, groups, and assignments are deferred until the real identity source and human access model are approved. This Terraform owns machine deployment roles only.
- **State backend:** local backends are temporary and keep this configuration valid before AWS exists. Before any real plan, create an encrypted/versioned S3 state bucket and DynamoDB-compatible lock strategy in `alter-management`, migrate every state with `terraform init -migrate-state`, and review the migration output. No nonexistent bucket is hardcoded here.

## Data, messaging, configuration, and compute foundation

The `dev`, `staging`, and `prod` account stacks extend the landing zone through four deliberately separate modules. `data` owns Aurora and ElastiCache, `messaging` owns artifacts and event transport, `runtime-config` owns AppConfig and secret-path enforcement, and `compute` owns the environment's ECS Fargate cluster. `shared-services` alone instantiates `ecr`; `sandbox-exec` instantiates only its isolated `compute` cluster. Existing landing-zone resources remain owned by the original `environment` module.

- **Control-plane database separation:** one Aurora PostgreSQL Serverless v2 cluster per workload environment starts with `platform_db`. A Data API bootstrap connects through the stable `postgres` administration database, creates the other six approved databases, creates a unique IAM-authenticated PostgreSQL role for every owning service, changes each database owner to that role, revokes PostgreSQL's default `PUBLIC` `CONNECT` and `TEMPORARY` privileges, and grants `CONNECT` only to the owning role. The bootstrap passes only the RDS-managed admin secret ARN to AWS; it never fetches, prints, or stores the generated master password. Seven distinct Secrets Manager containers and seven one-database IAM policies use `/alter/{env}/{service}/system/database_credentials`. The tests enforce one-to-one Terraform grants and simulate the effective PostgreSQL ACLs through separate Data API calls, allowing the seven owner connections while rejecting all 42 cross-service database connections. Both Aurora clusters export PostgreSQL logs, use enhanced monitoring and Performance Insights, and are selected into a daily AWS Backup plan.
- **ADS:** a second Aurora Serverless v2 cluster per workload environment has no `database_name` and no schema bootstrap. It is an intentionally empty, separately encrypted ADS shell in the same private data subnets.
- **Redis:** ElastiCache for Redis is the AWS-native implementation of the Redis/Valkey contract. Each workload environment gets a two-node, Multi-AZ, private-subnet replication group with encryption in transit and at rest. Its default user is disabled; the runtime user uses IAM authentication, so no static Redis password exists.
- **Artifact lifecycle:** clients tag objects with `retention_class`. `build-log` and `failed-run-diagnostic` expire after 90 days; `preview-artifact` expires after 30 days. `release-artifact` intentionally has no expiration rule and therefore lasts for project lifetime. Versioning, KMS encryption, public-access blocking, TLS-only access, event notifications, incomplete-upload cleanup, and a dedicated access-log bucket are enabled.
- **Messaging:** each workload environment has one custom EventBridge bus, an ordered canonical FIFO queue with FIFO DLQ, and a cost-event queue with its own DLQ. FOUND-7 is not present on the base commit, so `alter-{env}-cost-events` and source `alter.cost-ledger` are explicit reconciliation placeholders; update both only if FOUND-7 later establishes a different contract.
- **Runtime configuration and secrets:** AppConfig application/environment/profile scaffolding is created without hosted policy documents. A dedicated rotating KMS key and unattached IAM policy templates enforce `/alter/{env}/{service}/system/{secret_name}` and `/alter/{env}/tenant/{tenant_id}/integration/{integration_id}/{secret_name}`. No generic secret values are provisioned. Each environment uses its own account-scoped key, so no dev or staging identity is named in the production policy.
- **Compute and images:** dev, staging, production, and sandbox each receive a distinct ECS cluster using Fargate capacity providers and encrypted execute-command logs. The sandbox cluster is tagged as a separate blast radius. Shared-services owns exactly ten immutable, KMS-encrypted, scan-on-push ECR repositories; `platform-web` is excluded because it deploys to Vercel.

Aurora engine versions, Serverless v2 capacity, backup retention, deletion protection, Redis version/node size, and Redis snapshot retention are environment inputs. Example values are planning placeholders and must be rechecked against `ap-south-1` availability and approved by Platform/FinOps before a real plan.

The eventual real apply runner must include AWS CLI v2 because the database bootstrap calls RDS Data API after Aurora becomes available. It requires only the same short-lived AWS role used by Terraform and never resolves the managed master password locally.

### Static-analysis decisions

Checkov exceptions are inline and deliberately narrow. Artifact and access-log buckets do not replicate across regions because FOUND-4's SCP restricts workloads to `ap-south-1` and each environment already has an account-level isolation boundary. The access-log sink does not recursively log itself or emit application events. AWS requires an S3 server-access-log destination to use SSE-S3 rather than SSE-KMS, so only that audit sink uses SSE-S3; the artifact bucket remains customer-KMS encrypted. Database credential containers have no stored password version to rotate because services authenticate with short-lived RDS IAM tokens. These exceptions do not suppress encryption, public-access, TLS, backup, monitoring, or lifecycle checks on workload resources.

## Validation without AWS

The scripts explicitly unset ambient AWS credential variables and disable EC2 metadata. `mock_provider=true` removes assume-role/account lookups and exists only for offline plans; real variable files must set it to `false`.

```bash
./scripts/validate.sh
./scripts/test-database-separation.sh
tflint --init
tflint --recursive
checkov --config-file .checkov.yml
./scripts/mock-plan.sh
```

The mocked plans use invalid placeholder account values and `-refresh=false`. They prove Terraform graph/provider consistency only and cannot establish that AWS Organizations or account permissions are ready.

Future CI should install the pinned Terraform version, TFLint plus the pinned AWS ruleset, and Checkov, then run the same formatting, validation, lint, and static-analysis commands. CI must never run `apply` and must not expose production AWS credentials to pull-request jobs.
