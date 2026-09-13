-- #168: price a call by the model that served it, and by token direction.
--
-- model_pricing was keyed (provider, resource), so every model behind one
-- provider shared one per-token rate: Nova Micro, Lite and Pro all cost the
-- same per token through aws-bedrock. A cost derived from it was token count
-- times a constant, which cannot tell a cheap tier's call from an expensive
-- one's.
--
-- unit_cost_minor was also bigint, and no real per-token model price is a
-- whole number of minor units: Nova Micro's input rate is 0.0000035 US cents
-- per token. Every real price rounded to zero before it could be stored.

ALTER TABLE "model_pricing"
  ALTER COLUMN "unit_cost_minor" TYPE numeric USING "unit_cost_minor"::numeric;
--> statement-breakpoint

-- '' means "any model from this provider", so every existing row keeps
-- exactly the meaning it had, and a caller that sends no model still matches
-- only those rows.
ALTER TABLE "model_pricing"
  ADD COLUMN "model_id" text DEFAULT '' NOT NULL;
--> statement-breakpoint

ALTER TABLE "model_pricing" DROP CONSTRAINT "model_pricing_pk";
--> statement-breakpoint

ALTER TABLE "model_pricing"
  ADD CONSTRAINT "model_pricing_pk" PRIMARY KEY ("provider", "model_id", "resource");
--> statement-breakpoint

-- Published on-demand list prices for the models the model_alias_map binds
-- today (FAST -> Micro, STANDARD -> Lite, ADVANCED and CEILING -> Pro), in US
-- cents per token. Source: AWS, "Effective cost optimization strategies for
-- Amazon Bedrock" (10 June 2025), quoting US East (Ohio) on-demand pricing
-- current as of 21 May 2025:
--
--   Nova Micro  $0.000035 input, $0.00014 output per 1,000 tokens
--   Nova Lite   $0.00006  input, $0.00024 output per 1,000 tokens
--   Nova Pro    $0.0008   input, $0.0032  output per 1,000 tokens
--
-- The stack invokes the apac.* cross-region inference profiles, whose rates
-- may differ from US East. These rows are published list prices, not the
-- account's negotiated rates; replace them from the actual rate card before
-- treating any cost derived from them as a bill. ON CONFLICT DO NOTHING so a
-- price an operator has already set is never overwritten by this migration.
INSERT INTO "model_pricing" ("provider", "model_id", "resource", "unit_cost_minor", "currency")
VALUES
  ('aws-bedrock', 'apac.amazon.nova-micro-v1:0', 'input_tokens',  0.0000035, 'USD'),
  ('aws-bedrock', 'apac.amazon.nova-micro-v1:0', 'output_tokens', 0.000014,  'USD'),
  ('aws-bedrock', 'apac.amazon.nova-lite-v1:0',  'input_tokens',  0.000006,  'USD'),
  ('aws-bedrock', 'apac.amazon.nova-lite-v1:0',  'output_tokens', 0.000024,  'USD'),
  ('aws-bedrock', 'apac.amazon.nova-pro-v1:0',   'input_tokens',  0.00008,   'USD'),
  ('aws-bedrock', 'apac.amazon.nova-pro-v1:0',   'output_tokens', 0.00032,   'USD')
ON CONFLICT DO NOTHING;
