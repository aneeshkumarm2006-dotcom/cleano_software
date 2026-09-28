-- Email leg of the AI assistant: subject + threading id on conversations.
-- Additive and nullable; SMS rows simply leave them NULL. The tenant RLS
-- policies are row tests, so new columns need no policy or grant changes.
ALTER TABLE "AiConversation" ADD COLUMN "subject" TEXT;
ALTER TABLE "AiConversation" ADD COLUMN "lastEmailMessageId" TEXT;
