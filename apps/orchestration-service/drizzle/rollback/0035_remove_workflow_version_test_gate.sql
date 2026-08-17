UPDATE workflow_versions SET status = 'compiled' WHERE status = 'tested';
ALTER TABLE workflow_versions DROP CONSTRAINT workflow_versions_tested_evidence_check;
ALTER TABLE workflow_versions DROP CONSTRAINT workflow_versions_status_check;
ALTER TABLE workflow_versions ADD CONSTRAINT workflow_versions_status_check CHECK (status IN ('compiled', 'canary', 'promoted', 'rolled_back', 'retired'));
ALTER TABLE workflow_versions DROP COLUMN evaluation_failed_at;
ALTER TABLE workflow_versions DROP COLUMN tested_at;
ALTER TABLE workflow_versions DROP COLUMN evaluation_run_id;
