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

## Validation without AWS

The scripts explicitly unset ambient AWS credential variables and disable EC2 metadata. `mock_provider=true` removes assume-role/account lookups and exists only for offline plans; real variable files must set it to `false`.

```bash
./scripts/validate.sh
tflint --init
tflint --recursive
checkov --config-file .checkov.yml
./scripts/mock-plan.sh
```

The mocked plans use invalid placeholder account values and `-refresh=false`. They prove Terraform graph/provider consistency only and cannot establish that AWS Organizations or account permissions are ready.

Future CI should install the pinned Terraform version, TFLint plus the pinned AWS ruleset, and Checkov, then run the same formatting, validation, lint, and static-analysis commands. CI must never run `apply` and must not expose production AWS credentials to pull-request jobs.
