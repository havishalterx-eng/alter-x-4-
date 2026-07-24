CREATE TABLE "workflows" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workflows_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "workflows_status_check" CHECK ("status" IN ('draft', 'active', 'archived'))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_tenant_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER "workflows_reject_tenant_id_change"
BEFORE UPDATE ON "workflows"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflows_tenant_context_isolation" ON "workflows"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
