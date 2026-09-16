-- The Voice component is removed from the build: no channel can create a voice
-- conversation any more, so the channel value goes with it. Refuses rather than
-- silently rewriting history if a voice conversation somehow exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "conversations" WHERE "channel" = 'voice') THEN
    RAISE EXCEPTION 'cannot remove the voice conversation channel while voice conversations exist';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_channel_check";
--> statement-breakpoint
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_channel_check"
  CHECK ("channel" IN ('web', 'whatsapp', 'api'));
