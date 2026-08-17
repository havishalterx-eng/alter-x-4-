ALTER TABLE workflow_versions ADD COLUMN evaluation_run_id text;
ALTER TABLE workflow_versions ADD COLUMN tested_at timestamptz;
ALTER TABLE workflow_versions ADD COLUMN evaluation_failed_at timestamptz;
ALTER TABLE workflow_versions DROP CONSTRAINT workflow_versions_status_check;
ALTER TABLE workflow_versions ADD CONSTRAINT workflow_versions_status_check CHECK ("status" IN ('compiled', 'tested', 'canary', 'promoted', 'rolled_back', 'retired'));
ALTER TABLE workflow_versions ADD CONSTRAINT workflow_versions_tested_evidence_check CHECK ("status" <> 'tested' OR (evaluation_run_id IS NOT NULL AND tested_at IS NOT NULL));
