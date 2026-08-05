CREATE TABLE IF NOT EXISTS "action_item_annotations" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'ain\_%'),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "item_type" text NOT NULL CHECK ("item_type" IN ('approval','clarification','escalation')),
  "item_id" text NOT NULL,
  "note" text NOT NULL CHECK (char_length("note") BETWEEN 1 AND 4000),
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_item_annotations_item_idx" ON "action_item_annotations" ("tenant_id", "item_type", "item_id", "created_at");
--> statement-breakpoint
ALTER TABLE "action_item_annotations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_item_annotations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "action_item_annotations_tenant_context_isolation" ON "action_item_annotations";
--> statement-breakpoint
CREATE POLICY "action_item_annotations_tenant_context_isolation" ON "action_item_annotations" USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_action_item_annotation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'action_item_annotations is append-only'; END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS action_item_annotations_append_only ON "action_item_annotations";
--> statement-breakpoint
CREATE TRIGGER action_item_annotations_append_only BEFORE UPDATE OR DELETE ON "action_item_annotations" FOR EACH ROW EXECUTE FUNCTION prevent_action_item_annotation_mutation();
