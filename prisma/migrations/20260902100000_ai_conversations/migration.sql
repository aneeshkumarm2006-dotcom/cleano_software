-- AI assistant conversations (Step 2 of the AI receptionist).
-- Two tenant tables + three enums. Additive only — nothing existing changes.

-- CreateEnum
CREATE TYPE "AiChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "AiMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "AiMessageAuthor" AS ENUM ('CUSTOMER', 'ASSISTANT', 'STAFF');

-- CreateTable
CREATE TABLE "AiConversation" (
    "organizationId" TEXT NOT NULL DEFAULT '',
    "id" TEXT NOT NULL,
    "channel" "AiChannel" NOT NULL,
    "customerAddress" TEXT NOT NULL,
    "clientId" TEXT,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "organizationId" TEXT NOT NULL DEFAULT '',
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "AiMessageDirection" NOT NULL,
    "author" "AiMessageAuthor" NOT NULL,
    "body" TEXT NOT NULL,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiConversation_organizationId_lastMessageAt_idx" ON "AiConversation"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AiConversation_organizationId_needsHuman_lastMessageAt_idx" ON "AiConversation"("organizationId", "needsHuman", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AiConversation_organizationId_channel_customerAddress_idx" ON "AiConversation"("organizationId", "channel", "customerAddress");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiMessage_organizationId_createdAt_idx" ON "AiMessage"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same shape as every other customer table: a company reads
-- its own conversations and nobody else's. The platform client connects as a
-- role that bypasses these policies.
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "AiConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiConversation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AiConversation_tenant_isolation" ON "AiConversation";
CREATE POLICY "AiConversation_tenant_isolation" ON "AiConversation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "AiMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AiMessage_tenant_isolation" ON "AiMessage";
CREATE POLICY "AiMessage_tenant_isolation" ON "AiMessage"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- The application role needs access to the new tenant tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON "AiConversation" TO awer_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AiMessage" TO awer_app;
