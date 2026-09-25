-- User presence
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- Chat email throttle timestamps
ALTER TABLE "ChatConversation" ADD COLUMN "lastAdminEmailAt" TIMESTAMP(3);
ALTER TABLE "ChatConversation" ADD COLUMN "lastEmployeeEmailAt" TIMESTAMP(3);

-- Chat delivery state
ALTER TABLE "ChatMessage" ADD COLUMN "deliveredAt" TIMESTAMP(3);
