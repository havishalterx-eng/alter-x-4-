-- Global plan definitions: the staff-authored layer underneath the existing
-- per-tenant entitlement override (`entitlements.limits`, written by
-- POST /api/v1/admin/tenants/:tenantId/entitlements). A row here replaces
-- the ConfigProvider baseline for that plan; absent rows fall through to the
-- AppConfig/local-file ConfigProvider unchanged.
--
-- Not tenant-scoped, so no RLS -- same as the rest of the staff plane
-- (`staff_users`, `jit_grants`, `tenant_admin_actions`).
CREATE TABLE IF NOT EXISTS "plan_definitions" (
  "plan" text PRIMARY KEY
    CHECK (char_length("plan") BETWEEN 1 AND 100),
  "limits" jsonb NOT NULL
    -- Exactly the seven ENTITLEMENT_LIMIT_KEYS, each a non-negative integer.
    -- `?&` requires every known key. `limits - ARRAY[...]` strips those keys;
    -- anything left over is an unknown key and fails the constraint.
    CHECK (
      jsonb_typeof("limits") = 'object'
      AND "limits" ?& ARRAY[
        'maxWorkflows',
        'maxProjects',
        'maxRunsPerDay',
        'maxConcurrentRuns',
        'maxSandboxMinutesPerMonth',
        'maxAdsStorageMb',
        'maxIntegrations'
      ]
      AND ("limits" ->> 'maxWorkflows') ~ '^[0-9]+$'
      AND ("limits" ->> 'maxProjects') ~ '^[0-9]+$'
      AND ("limits" ->> 'maxRunsPerDay') ~ '^[0-9]+$'
      AND ("limits" ->> 'maxConcurrentRuns') ~ '^[0-9]+$'
      AND ("limits" ->> 'maxSandboxMinutesPerMonth') ~ '^[0-9]+$'
      AND ("limits" ->> 'maxAdsStorageMb') ~ '^[0-9]+$'
      AND ("limits" ->> 'maxIntegrations') ~ '^[0-9]+$'
      AND ("limits" - ARRAY[
        'maxWorkflows',
        'maxProjects',
        'maxRunsPerDay',
        'maxConcurrentRuns',
        'maxSandboxMinutesPerMonth',
        'maxAdsStorageMb',
        'maxIntegrations'
      ]) = '{}'::jsonb
    ),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" text NOT NULL REFERENCES "staff_users"("id")
);
--> statement-breakpoint
-- Append-only history, mirroring `jit_grant_audit` / `tenant_admin_actions`.
-- `plan` is a plain column, not an FK: a deleted plan definition must keep
-- its history.
CREATE TABLE IF NOT EXISTS "plan_definition_audit" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'pda\_%'),
  "plan" text NOT NULL,
  "action" text NOT NULL
    CHECK ("action" IN ('created', 'updated', 'deleted')),
  "limits" jsonb,
  "reason" text NOT NULL,
  "staff_user_id" text NOT NULL REFERENCES "staff_users"("id"),
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_definition_audit_plan_idx"
ON "plan_definition_audit" ("plan", "occurred_at" DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_plan_definition_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'plan_definition_audit is append-only'; END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS plan_definition_audit_append_only ON "plan_definition_audit";
--> statement-breakpoint
CREATE TRIGGER plan_definition_audit_append_only
BEFORE UPDATE OR DELETE ON "plan_definition_audit"
FOR EACH ROW EXECUTE FUNCTION prevent_plan_definition_audit_mutation();
