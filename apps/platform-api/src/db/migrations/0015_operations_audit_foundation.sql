ALTER TABLE "jit_grants"
ADD COLUMN IF NOT EXISTS "scopes" text[] NOT NULL DEFAULT ARRAY['tenant:read']::text[];
--> statement-breakpoint
ALTER TABLE "jit_grants"
DROP CONSTRAINT IF EXISTS "jit_grants_scopes_check";
--> statement-breakpoint
ALTER TABLE "jit_grants"
ADD CONSTRAINT "jit_grants_scopes_check" CHECK (
  cardinality("scopes") > 0
  AND "scopes" <@ ARRAY[
    'tenant:read',
    'audit:read',
    'workflows:read',
    'runs:read',
    'billing:read'
  ]::text[]
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jit_grants_active_scope_idx"
ON "jit_grants" ("staff_user_id", "tenant_id", "expires_at")
WHERE "revoked_at" IS NULL;
