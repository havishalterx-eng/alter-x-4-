ALTER TABLE "conversations" DROP CONSTRAINT "conversations_channel_check";
--> statement-breakpoint
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_channel_check"
  CHECK ("channel" IN ('web', 'whatsapp', 'voice', 'api'));
