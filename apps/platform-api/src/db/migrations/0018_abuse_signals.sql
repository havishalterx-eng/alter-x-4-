CREATE TABLE IF NOT EXISTS abuse_signals (
  id text PRIMARY KEY CHECK (id ~ '^abs_[0-9a-f-]{36}$'),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  signal_type text NOT NULL CHECK (signal_type IN (
    'payment_fraud',
    'free_tier_velocity',
    'credential_abuse',
    'marketplace_supply_chain'
  )),
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 128),
  score numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  evidence_ref text NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 512),
  source_fingerprint text NOT NULL UNIQUE CHECK (length(source_fingerprint) BETWEEN 1 AND 512),
  observed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'dismissed')),
  reviewed_by text REFERENCES staff_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS abuse_signals_queue_idx
  ON abuse_signals (status, score DESC, observed_at DESC);
CREATE INDEX IF NOT EXISTS abuse_signals_tenant_idx
  ON abuse_signals (tenant_id, observed_at DESC);
