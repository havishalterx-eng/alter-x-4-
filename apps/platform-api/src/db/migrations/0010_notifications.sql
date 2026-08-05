CREATE TABLE IF NOT EXISTS "notification_events" (
  "id" text PRIMARY KEY CHECK ("id" ~ '^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "workspace_id" uuid NOT NULL,
  "event_class" text NOT NULL CHECK ("event_class" IN ('workflow', 'project', 'deployment', 'approval', 'budget', 'system')),
  "severity" text NOT NULL CHECK ("severity" IN ('info', 'warning', 'critical')),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "deep_link" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "source_service" text NOT NULL,
  CONSTRAINT "notification_events_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "notification_events_tenant_workspace_fk"
    FOREIGN KEY ("tenant_id", "workspace_id")
    REFERENCES "workspaces"("tenant_id", "id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_events_tenant_workspace_created_idx"
ON "notification_events" ("tenant_id", "workspace_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_reads" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "notification_event_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "in_app_enabled" boolean NOT NULL DEFAULT true,
  "read_at" timestamptz,
  "acknowledged_at" timestamptz,
  CONSTRAINT "notification_reads_tenant_event_fk"
    FOREIGN KEY ("tenant_id", "notification_event_id")
    REFERENCES "notification_events"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "notification_reads_tenant_user_fk"
    FOREIGN KEY ("tenant_id", "user_id")
    REFERENCES "tenant_members"("tenant_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "notification_reads_tenant_event_user_unique"
    UNIQUE ("tenant_id", "notification_event_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_reads_tenant_user_in_app_idx"
ON "notification_reads" ("tenant_id", "user_id", "in_app_enabled", "notification_event_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "user_id" uuid NOT NULL,
  "event_class" text NOT NULL CHECK ("event_class" IN ('workflow', 'project', 'deployment', 'approval', 'budget', 'system')),
  "channel" text NOT NULL CHECK ("channel" IN ('in_app', 'email')),
  "enabled" boolean NOT NULL DEFAULT true,
  CONSTRAINT "notification_preferences_tenant_user_fk"
    FOREIGN KEY ("tenant_id", "user_id")
    REFERENCES "tenant_members"("tenant_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "notification_preferences_tenant_user_event_channel_unique"
    UNIQUE ("tenant_id", "user_id", "event_class", "channel")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_preferences_tenant_user_idx"
ON "notification_preferences" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_digests" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "user_id" uuid NOT NULL,
  "period_start" timestamptz NOT NULL,
  "period_end" timestamptz NOT NULL,
  "sent_at" timestamptz,
  "delivery_started_at" timestamptz,
  "event_ids_json" jsonb NOT NULL,
  CONSTRAINT "notification_digests_period_valid" CHECK ("period_start" < "period_end"),
  CONSTRAINT "notification_digests_tenant_user_fk"
    FOREIGN KEY ("tenant_id", "user_id")
    REFERENCES "tenant_members"("tenant_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "notification_digests_tenant_user_period_unique"
    UNIQUE ("tenant_id", "user_id", "period_start", "period_end")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_digests_tenant_user_sent_idx"
ON "notification_digests" ("tenant_id", "user_id", "sent_at");
--> statement-breakpoint
DROP TRIGGER IF EXISTS notification_events_prevent_tenant_id_update ON "notification_events";
--> statement-breakpoint
CREATE TRIGGER notification_events_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "notification_events"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS notification_reads_prevent_tenant_id_update ON "notification_reads";
--> statement-breakpoint
CREATE TRIGGER notification_reads_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "notification_reads"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS notification_preferences_prevent_tenant_id_update ON "notification_preferences";
--> statement-breakpoint
CREATE TRIGGER notification_preferences_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "notification_preferences"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS notification_digests_prevent_tenant_id_update ON "notification_digests";
--> statement-breakpoint
CREATE TRIGGER notification_digests_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "notification_digests"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "notification_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_reads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_digests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_digests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS notification_events_tenant_isolation ON "notification_events";
--> statement-breakpoint
CREATE POLICY notification_events_tenant_isolation ON "notification_events"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS notification_reads_tenant_isolation ON "notification_reads";
--> statement-breakpoint
CREATE POLICY notification_reads_tenant_isolation ON "notification_reads"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS notification_preferences_tenant_isolation ON "notification_preferences";
--> statement-breakpoint
CREATE POLICY notification_preferences_tenant_isolation ON "notification_preferences"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS notification_digests_tenant_isolation ON "notification_digests";
--> statement-breakpoint
CREATE POLICY notification_digests_tenant_isolation ON "notification_digests"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
