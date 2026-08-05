ALTER TABLE "notification_preferences"
ADD COLUMN IF NOT EXISTS "delivery_mode" text NOT NULL DEFAULT 'immediate'
CHECK ("delivery_mode" IN ('immediate', 'digest'));
