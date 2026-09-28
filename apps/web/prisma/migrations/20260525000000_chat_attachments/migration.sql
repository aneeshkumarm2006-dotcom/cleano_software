-- Add optional attachment fields to chat messages (images / documents).
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentType" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentName" TEXT;
