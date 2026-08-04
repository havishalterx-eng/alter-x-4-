CREATE TABLE IF NOT EXISTS "tool_manifests" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'tlm\_%'), "tenant_id" text, "name" text NOT NULL,
  "ecosystem" text NOT NULL CHECK ("ecosystem" IN ('npm','pip','mcp')), "description" text,
  "trust_level" text NOT NULL CHECK ("trust_level" IN ('alter_verified','verified_publisher','community_reviewed','unverified_private','blocked')),
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','published','blocked')),
  "publisher_id" text REFERENCES "publishers"("id"), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tool_manifests_tenant_name_unique" UNIQUE ("tenant_id", "name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_versions" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'tlv\_%'), "manifest_id" text NOT NULL REFERENCES "tool_manifests"("id"), "version" text NOT NULL,
  "artifact_ref" text NOT NULL, "capabilities_json" jsonb NOT NULL, "permissions_json" jsonb NOT NULL, "pinned" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','scanning','scan_failed','published','revoked')), "published_at" timestamptz,
  CONSTRAINT "tool_versions_manifest_version_unique" UNIQUE ("manifest_id", "version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_scan_reports" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'scn\_%'), "tenant_id" text NOT NULL, "tool_version_id" text NOT NULL REFERENCES "tool_versions"("id"),
  "verdict" text NOT NULL CHECK ("verdict" IN ('clean','findings','blocked','errored')), "findings_json" jsonb NOT NULL,
  "scanner_version" text NOT NULL, "duration_ms" integer NOT NULL CHECK ("duration_ms" >= 0), "scanned_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_revocations" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'rvk\_%'), "tenant_id" text NOT NULL, "manifest_id" text NOT NULL REFERENCES "tool_manifests"("id"), "tool_version_id" text NOT NULL REFERENCES "tool_versions"("id"),
  "reason" text NOT NULL, "revoked_by" text NOT NULL, "revoked_at" timestamptz NOT NULL DEFAULT now(), "propagated_at" timestamptz,
  CONSTRAINT "tool_revocations_version_unique" UNIQUE ("tool_version_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_versions_manifest_id_idx" ON "tool_versions" ("manifest_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_manifests_publisher_id_idx" ON "tool_manifests" ("publisher_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_scan_reports_tenant_version_idx" ON "tool_scan_reports" ("tenant_id", "tool_version_id", "scanned_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_revocations_tenant_manifest_idx" ON "tool_revocations" ("tenant_id", "manifest_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_registry_tenant_id_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'tenant_id is immutable'; END IF; RETURN NEW; END; $$;
--> statement-breakpoint
CREATE TRIGGER tool_manifests_tenant_id_immutable BEFORE UPDATE ON "tool_manifests" FOR EACH ROW EXECUTE FUNCTION reject_registry_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER tool_scan_reports_tenant_id_immutable BEFORE UPDATE ON "tool_scan_reports" FOR EACH ROW EXECUTE FUNCTION reject_registry_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER tool_revocations_tenant_id_immutable BEFORE UPDATE ON "tool_revocations" FOR EACH ROW EXECUTE FUNCTION reject_registry_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "tool_manifests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tool_manifests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tool_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tool_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tool_scan_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tool_scan_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tool_revocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tool_revocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tool_manifests_catalogue_select" ON "tool_manifests" FOR SELECT USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '') OR ("status" = 'published' AND "trust_level" <> 'blocked'));
--> statement-breakpoint
CREATE POLICY "tool_manifests_tenant_owner" ON "tool_manifests" FOR ALL USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '') AND "tenant_id" IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "tool_versions_catalogue_select" ON "tool_versions" FOR SELECT USING (EXISTS (SELECT 1 FROM "tool_manifests" WHERE "tool_manifests"."id" = "tool_versions"."manifest_id" AND ("tool_manifests"."tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '') OR ("tool_manifests"."status" = 'published' AND "tool_manifests"."trust_level" <> 'blocked' AND "tool_versions"."status" = 'published'))));
--> statement-breakpoint
CREATE POLICY "tool_versions_tenant_owner" ON "tool_versions" FOR ALL USING (EXISTS (SELECT 1 FROM "tool_manifests" WHERE "tool_manifests"."id" = "tool_versions"."manifest_id" AND "tool_manifests"."tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))) WITH CHECK (EXISTS (SELECT 1 FROM "tool_manifests" WHERE "tool_manifests"."id" = "tool_versions"."manifest_id" AND "tool_manifests"."tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')));
--> statement-breakpoint
CREATE POLICY "tool_scan_reports_tenant_isolation" ON "tool_scan_reports" FOR ALL USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY "tool_revocations_tenant_isolation" ON "tool_revocations" FOR ALL USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
