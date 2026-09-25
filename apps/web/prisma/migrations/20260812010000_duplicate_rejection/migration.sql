-- Client feedback item 9 (Stage 6.8) — Manage Duplicates rebuild.
--
-- Rejection ("these two are not the same person") becomes a PAIR fact instead
-- of a per-record flag. The old mechanism set `Contact.duplicateDismissed` on
-- every member of a group, which had three consequences the client's "I don't
-- really know what's going on here" sat on top of:
--   1. rejecting a 3-record group also suppressed the genuinely-duplicate pair
--      hiding inside it;
--   2. the suppressed contacts never surfaced again — not even against a brand
--      new duplicate created next month;
--   3. there was no undo and no way to review what had been rejected.
--
-- `duplicateDismissed` is deliberately LEFT IN PLACE and still read by
-- detection, so anything an admin dismissed before this deploy stays hidden.
-- New rejections all land here.
--
-- "contactAId" always holds the lexicographically smaller of the two ids, so
-- the unique index below catches the same pair submitted in either order.
-- Cascade on both FKs: a hard-deleted contact takes its rejections with it
-- (soft-deleted/archived contacts drop out of detection anyway).
CREATE TABLE "DuplicateRejection" (
    "id" TEXT NOT NULL,
    "contactAId" TEXT NOT NULL,
    "contactBId" TEXT NOT NULL,
    "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectedBy" TEXT,

    CONSTRAINT "DuplicateRejection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DuplicateRejection_contactAId_contactBId_key" ON "DuplicateRejection"("contactAId", "contactBId");
CREATE INDEX "DuplicateRejection_contactBId_idx" ON "DuplicateRejection"("contactBId");
CREATE INDEX "DuplicateRejection_rejectedAt_idx" ON "DuplicateRejection"("rejectedAt");

ALTER TABLE "DuplicateRejection" ADD CONSTRAINT "DuplicateRejection_contactAId_fkey" FOREIGN KEY ("contactAId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuplicateRejection" ADD CONSTRAINT "DuplicateRejection_contactBId_fkey" FOREIGN KEY ("contactBId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
