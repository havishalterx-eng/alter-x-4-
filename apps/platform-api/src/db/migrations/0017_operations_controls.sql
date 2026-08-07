CREATE TABLE IF NOT EXISTS feature_flags (
  name text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9._-]{1,127}$'),
  enabled boolean NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by text NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_flags_updated_at_idx
  ON feature_flags (updated_at DESC);
