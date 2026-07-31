CREATE TABLE "cost_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "mode" text NOT NULL,
  "parent_id" uuid,
  "run_id" uuid,
  "node_execution_id" uuid,
  "source" text NOT NULL,
  "provider" text NOT NULL,
  "resource" text NOT NULL,
  "quantity" numeric NOT NULL,
  "unit" text NOT NULL,
  "internal_cost_minor" bigint NOT NULL,
  "currency" text DEFAULT 'INR' NOT NULL,
  "is_retry" boolean DEFAULT false NOT NULL,
  "is_recovery" boolean DEFAULT false NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  CONSTRAINT "cost_events_mode_check" CHECK ("mode" IN ('workflow', 'project')),
  CONSTRAINT "cost_events_source_check" CHECK ("source" IN ('model_gateway', 'tool_gateway', 'sandbox', 'storage', 'browser')),
  CONSTRAINT "cost_events_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "cost_events_internal_cost_minor_check" CHECK ("internal_cost_minor" >= 0)
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
CREATE TRIGGER "cost_events_reject_tenant_id_change"
BEFORE UPDATE ON "cost_events"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "cost_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cost_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "cost_events_tenant_context_isolation" ON "cost_events"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_cost_events_tenant_occurred" ON "cost_events" ("tenant_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "idx_cost_events_tenant_run" ON "cost_events" ("tenant_id", "run_id");
--> statement-breakpoint
CREATE INDEX "idx_cost_events_tenant_parent" ON "cost_events" ("tenant_id", "parent_id");
--> statement-breakpoint
CREATE INDEX "idx_cost_events_tenant_mode_source" ON "cost_events" ("tenant_id", "mode", "source");
