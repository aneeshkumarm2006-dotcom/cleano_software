-- API v1, messages and kit (packages/api/src/v1/messages.ts, kit.ts).
--
-- Additive only: nullable columns on four existing tables and two unique
-- indexes over columns no existing row sets (NULLs are distinct, so every
-- existing row is unaffected). No row is rewritten and nothing the web reads
-- changes meaning. Reverses by dropping what it adds. No new table, so no new
-- RLS policy or grant: the columns inherit their table's.
--
--   ChatMessage.clientEventId   the id the sending phone made for an office
--                               chat message; returned to its sender only
--   GroupMessage.clientEventId  the same, for team chat
--   GroupMessage.editedAt       when its sender last edited it
--   GroupMessage.deletedById    who deleted it: the sender, or the office
--                               moderator (manager-messages.ts). The body stays
--                               on the row and is never served once deleted.
--   InventoryChange.issuedWriteOff
--                               on a cleaner's LOST/BROKEN report: how much of
--                               the write-off was stock that had already left
--                               the warehouse when it was issued (a pickup or a
--                               fulfilled request), so it moved no warehouse
--                               stock at the report. Needed to cap a write-off
--                               at what the office put in the cleaner's hands
--                               without taking pickup stock off a location twice.

ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "clientEventId" TEXT;

ALTER TABLE "GroupMessage"
  ADD COLUMN IF NOT EXISTS "clientEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

ALTER TABLE "InventoryChange" ADD COLUMN IF NOT EXISTS "issuedWriteOff" DOUBLE PRECISION;

-- One message per phone tap, per sender. A retry after the idempotency record
-- has expired finds the message it already made instead of posting twice.
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessage_organizationId_senderId_clientEventId_key"
  ON "ChatMessage" ("organizationId", "senderId", "clientEventId");
CREATE UNIQUE INDEX IF NOT EXISTS "GroupMessage_organizationId_senderId_clientEventId_key"
  ON "GroupMessage" ("organizationId", "senderId", "clientEventId");
