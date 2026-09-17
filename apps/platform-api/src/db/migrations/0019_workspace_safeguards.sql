-- Workspace safeguard defaults: organisational rules a workspace owner sets
-- once, instead of each person ticking boxes on every plan request.
--
--   contains_pii              the workspace's runs handle personal data, so
--                             delivered output is verified before it leaves.
--   approve_external_actions  a person approves every action that may send or
--                             change something outside Alter.
--
-- Both start on, for existing workspaces and new ones: protection must not
-- depend on someone remembering to turn it on. Stored explicitly per workspace
-- rather than implied by code, so changing the product default later never
-- silently changes a rule a workspace already has.
--
-- The CHECK keeps the value exactly these two booleans, matching the API
-- schema, so a direct SQL write cannot store something the reader rejects.
--
-- Rollback: ALTER TABLE workspaces DROP COLUMN safeguards;
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "safeguards" jsonb NOT NULL
  DEFAULT '{"contains_pii": true, "approve_external_actions": true}'::jsonb
  CONSTRAINT "workspaces_safeguards_shape" CHECK (
    jsonb_typeof("safeguards") = 'object'
    AND "safeguards" ?& ARRAY['contains_pii', 'approve_external_actions']
    AND "safeguards" - 'contains_pii' - 'approve_external_actions' = '{}'::jsonb
    AND jsonb_typeof("safeguards" -> 'contains_pii') = 'boolean'
    AND jsonb_typeof("safeguards" -> 'approve_external_actions') = 'boolean'
  );
