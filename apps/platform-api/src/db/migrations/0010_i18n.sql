CREATE TABLE IF NOT EXISTS "i18n_bundles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "locale" text NOT NULL CHECK ("locale" IN ('en', 'hi')),
  "namespace" text NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "i18n_bundles_locale_namespace_key_unique"
    UNIQUE ("locale", "namespace", "key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "i18n_bundles_locale_namespace_idx"
ON "i18n_bundles" ("locale", "namespace");
--> statement-breakpoint
INSERT INTO "i18n_bundles" ("locale", "namespace", "key", "value")
VALUES
  ('en', 'ui', 'language.english', 'English'),
  ('en', 'ui', 'language.hindi', 'Hindi'),
  ('hi', 'ui', 'language.english', 'अंग्रेज़ी'),
  ('hi', 'ui', 'language.hindi', 'हिन्दी'),
  ('en', 'notifications', 'title', 'Notification'),
  ('hi', 'notifications', 'title', 'सूचना'),
  ('en', 'emails', 'greeting', 'Hello'),
  ('hi', 'emails', 'greeting', 'नमस्ते')
ON CONFLICT ("locale", "namespace", "key") DO UPDATE
SET "value" = EXCLUDED."value",
    "updated_at" = now();
--> statement-breakpoint
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "preferred_language" text DEFAULT 'en'
CHECK ("preferred_language" IN ('en', 'hi'));
--> statement-breakpoint
ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "default_language" text NOT NULL DEFAULT 'en'
CHECK ("default_language" IN ('en', 'hi'));
