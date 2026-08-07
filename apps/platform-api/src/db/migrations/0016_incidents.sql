CREATE TABLE IF NOT EXISTS admin_incidents (
  id text PRIMARY KEY CHECK (id ~ '^inc_[0-9a-f-]{36}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
  severity text NOT NULL CHECK (severity IN ('sev1', 'sev2', 'sev3')),
  impacted_services text[] NOT NULL CHECK (cardinality(impacted_services) BETWEEN 1 AND 50),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'investigating', 'monitoring', 'resolved')),
  publication_state text NOT NULL DEFAULT 'not_requested' CHECK (
    publication_state IN ('not_requested', 'pending_approval', 'approved', 'publishing', 'published', 'rejected')
  ),
  created_by text NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  publication_requested_by text REFERENCES staff_users(id) ON DELETE RESTRICT,
  publication_requested_at timestamptz,
  publication_request_reason text,
  approved_by text REFERENCES staff_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approval_reason text,
  provider_incident_ref text,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((publication_requested_by IS NULL) = (publication_requested_at IS NULL)),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK ((provider_incident_ref IS NULL) = (published_at IS NULL))
);

CREATE INDEX IF NOT EXISTS admin_incidents_created_at_idx
  ON admin_incidents (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_incidents_publication_state_idx
  ON admin_incidents (publication_state, updated_at);
