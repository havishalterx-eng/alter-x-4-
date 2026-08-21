ALTER TABLE "tool_scan_reports"
DROP CONSTRAINT IF EXISTS "tool_scan_reports_verdict_check";
ALTER TABLE "tool_scan_reports"
ADD CONSTRAINT "tool_scan_reports_verdict_check" CHECK ("verdict" IN ('clean','findings','blocked','errored'));
ALTER TABLE "tool_versions"
DROP CONSTRAINT IF EXISTS "tool_versions_status_check";
ALTER TABLE "tool_versions"
ADD CONSTRAINT "tool_versions_status_check" CHECK ("status" IN ('draft','scanning','scan_failed','published','revoked'));
