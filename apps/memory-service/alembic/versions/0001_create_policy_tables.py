# ruff: noqa: E501
"""create policy_db tables

Revision ID: 0001
Revises:
Create Date: 2026-07-29

Covers policies, policy_promotions, drift_scores, and memory_records. Policies
are scoped by session context; promotions inherit policy visibility. Global rows
are readable broadly but writable only by policy_system_writer. Agent drift rows
are deliberately default-deny pending KNOW-15's local ownership projection.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("""
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
$function$
"""))
    op.execute(sa.text("""
CREATE TABLE policies (
 id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL, scope_id UUID, kind TEXT NOT NULL,
 version INTEGER NOT NULL, body JSONB NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL,
 eval_gate_run_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT policies_scope_check CHECK (scope IN ('global','tenant','workspace','workflow','project')),
 CONSTRAINT policies_kind_check CHECK (kind IN ('routing_weights','quality_thresholds','recovery_preferences','provider_policy','model_alias_map','trigger_limits')),
 CONSTRAINT policies_status_check CHECK (status IN ('draft','canary','active','rolled_back','retired')),
 CONSTRAINT policies_source_check CHECK (source IN ('human','memory_learning','drift_detector')),
 CONSTRAINT policies_scope_version_unique UNIQUE NULLS NOT DISTINCT (scope,scope_id,kind,version)
); CREATE INDEX idx_policies_scope_kind ON policies(scope,scope_id,kind,status);
"""))
    op.execute(sa.text("""
CREATE TABLE policy_promotions (
 id TEXT PRIMARY KEY NOT NULL, policy_id TEXT NOT NULL REFERENCES policies(id), from_version INTEGER,
 to_version INTEGER, action TEXT NOT NULL, reason TEXT, actor TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT policy_promotions_action_check CHECK(action IN ('promote','rollback'))
); CREATE INDEX idx_policy_promotions_policy ON policy_promotions(policy_id,created_at DESC);
CREATE TABLE drift_scores (
 id TEXT PRIMARY KEY NOT NULL, subject_type TEXT NOT NULL, subject_ref TEXT NOT NULL, task_class TEXT,
 score NUMERIC NOT NULL, baseline NUMERIC, "window" JSONB, action_taken TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT drift_scores_subject_check CHECK(subject_type IN ('agent','model','provider')),
 CONSTRAINT drift_scores_action_check CHECK(action_taken IS NULL OR action_taken IN ('none','weight_decay','flagged'))
); CREATE INDEX idx_drift_scores_subject ON drift_scores(subject_type,subject_ref,created_at DESC);
CREATE TABLE memory_records (
 id TEXT PRIMARY KEY NOT NULL, tenant_id UUID, scope TEXT NOT NULL, content JSONB NOT NULL,
 provenance JSONB NOT NULL, status TEXT NOT NULL, destination TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), promoted_at TIMESTAMPTZ,
 CONSTRAINT memory_records_scope_check CHECK(scope IN ('failure','global','project','safety_pattern')),
 CONSTRAINT memory_records_status_check CHECK(status IN ('candidate','verified','promoted','reverted')),
 CONSTRAINT memory_records_destination_check CHECK(destination IS NULL OR destination IN ('policy_store','ads_memory_namespace')),
 CONSTRAINT memory_records_global_tenant_check CHECK(tenant_id IS NOT NULL OR scope='global')
); CREATE INDEX idx_memory_records_tenant_scope ON memory_records(tenant_id,scope,created_at DESC);
"""))
    op.execute(sa.text("""
CREATE TRIGGER memory_records_reject_tenant_id_change BEFORE UPDATE ON memory_records FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
ALTER TABLE policies ENABLE ROW LEVEL SECURITY; ALTER TABLE policies FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_promotions ENABLE ROW LEVEL SECURITY; ALTER TABLE policy_promotions FORCE ROW LEVEL SECURITY;
ALTER TABLE drift_scores ENABLE ROW LEVEL SECURITY; ALTER TABLE drift_scores FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_records ENABLE ROW LEVEL SECURITY; ALTER TABLE memory_records FORCE ROW LEVEL SECURITY;
CREATE POLICY policies_read ON policies FOR SELECT USING (scope='global' OR (scope='tenant' AND scope_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid) OR (scope='workspace' AND scope_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid) OR (scope='workflow' AND scope_id=NULLIF(current_setting('app.current_workflow_id',true),'')::uuid) OR (scope='project' AND scope_id=NULLIF(current_setting('app.current_project_id',true),'')::uuid));
CREATE POLICY policies_write ON policies FOR ALL USING ((scope<>'global' AND ((scope='tenant' AND scope_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid) OR (scope='workspace' AND scope_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid) OR (scope='workflow' AND scope_id=NULLIF(current_setting('app.current_workflow_id',true),'')::uuid) OR (scope='project' AND scope_id=NULLIF(current_setting('app.current_project_id',true),'')::uuid))) OR (scope='global' AND current_user='policy_system_writer')) WITH CHECK ((scope<>'global' AND ((scope='tenant' AND scope_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid) OR (scope='workspace' AND scope_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid) OR (scope='workflow' AND scope_id=NULLIF(current_setting('app.current_workflow_id',true),'')::uuid) OR (scope='project' AND scope_id=NULLIF(current_setting('app.current_project_id',true),'')::uuid))) OR (scope='global' AND current_user='policy_system_writer'));
CREATE POLICY promotions_read ON policy_promotions FOR SELECT USING (EXISTS(SELECT 1 FROM policies p WHERE p.id=policy_id));
CREATE POLICY promotions_write ON policy_promotions FOR ALL USING (EXISTS(SELECT 1 FROM policies p WHERE p.id=policy_id AND (p.scope<>'global' OR current_user='policy_system_writer'))) WITH CHECK (EXISTS(SELECT 1 FROM policies p WHERE p.id=policy_id AND (p.scope<>'global' OR current_user='policy_system_writer')));
CREATE POLICY drift_read ON drift_scores FOR SELECT USING (subject_type IN ('model','provider'));
CREATE POLICY drift_system_write ON drift_scores FOR ALL USING (current_user='policy_system_writer') WITH CHECK (current_user='policy_system_writer');
CREATE POLICY memory_read ON memory_records FOR SELECT USING (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid OR (tenant_id IS NULL AND scope='global'));
CREATE POLICY memory_write ON memory_records FOR ALL USING ((tenant_id IS NOT NULL AND tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid) OR (tenant_id IS NULL AND scope='global' AND current_user='policy_system_writer')) WITH CHECK ((tenant_id IS NOT NULL AND tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid) OR (tenant_id IS NULL AND scope='global' AND current_user='policy_system_writer'));
"""))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS memory_records; DROP TABLE IF EXISTS drift_scores; DROP TABLE IF EXISTS policy_promotions; DROP TABLE IF EXISTS policies; DROP FUNCTION IF EXISTS reject_tenant_id_change()"))
