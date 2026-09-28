-- Assignment and an Open/Closed lifecycle for AI conversations.
--
-- Additive and reversible. `status` defaults to OPEN, which is what every
-- existing row already behaves as, so nothing changes until somebody closes
-- one. `assignedToId` starts NULL, i.e. unassigned, which is also today's
-- behaviour: nobody owns anything.
--
-- No RLS work is needed. AiConversation is already a tenant table with its
-- policy in place; adding columns does not change who can see a row.

CREATE TYPE "AiConversationStatus" AS ENUM ('OPEN', 'CLOSED');

ALTER TABLE "AiConversation"
  ADD COLUMN "assignedToId" TEXT,
  ADD COLUMN "status" "AiConversationStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "closedAt" TIMESTAMP(3);

-- "Assigned to me" and "Unassigned" are the two views people live in.
CREATE INDEX "AiConversation_assignedToId_idx"
  ON "AiConversation"("assignedToId");

-- The inbox's default read is "this workspace, still open, newest first".
CREATE INDEX "AiConversation_organizationId_status_idx"
  ON "AiConversation"("organizationId", "status");
