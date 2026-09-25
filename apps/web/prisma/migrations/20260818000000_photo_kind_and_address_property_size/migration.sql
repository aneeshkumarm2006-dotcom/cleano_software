-- New photo & address fixes (handoff after the inventory-operations PDF).
-- Covers item 1 (photo upload type) and item 3 (property size on the saved
-- address). Item 2 (postal code) needs NO schema: `ClientAddress.postalCode`
-- and `Job.postalCode` already exist — that item is wiring, not columns.
--
-- ── Why ────────────────────────────────────────────────────────────────────
--
-- 1. `JobPhoto.kind` — the handoff asks that photos "stay organized by upload
--    type: before, after, issue, or general job photo". Until now the ONLY
--    discriminator on a job photo was the free-text `caption`, so "before",
--    "after" and "the fridge seal is torn" were the same thing to every query
--    and every gallery. src/lib/job-photos.ts said so in as many words
--    ("JobPhoto carries no before/after discriminator"); this column is that
--    sentence being retired.
--
--    NOT NULL DEFAULT 'GENERAL' rather than nullable, because the two states
--    would mean the same thing. Every existing row is genuinely unclassified,
--    GENERAL is the name for that, and it is the bucket the galleries render
--    without a badge — so nothing about an existing photo changes on screen.
--    Nothing infers a kind from `caption`: a caption is prose typed on a phone,
--    and pattern-matching it would silently misfile exactly the photos someone
--    needs to find later ("after the spill" is not an AFTER photo).
--
-- 2. `ClientAddress.propertyType/bedCount/bathCount/halfBathCount/squareFootage`
--    — the handoff's item 3, verbatim: "this should prevent admin from
--    re-entering the same apartment/house size every time that customer books."
--    The five facts already exist on `Job`, and they STAY there and stay
--    authoritative for the job: a job row is the snapshot the visit was priced
--    and staffed from, and a property that finishes its basement next year must
--    not rewrite last year's invoice. These columns are the per-address DEFAULT
--    that pre-fills the next booking, learned back from a booking only while
--    the address row is still blank.
--
--    Deliberately per-ADDRESS, not per-client: the handoff spells out that "if
--    a customer has multiple addresses, each address should have its own saved
--    property size", which a column on `Client` cannot express.
--
-- ── Blast radius ───────────────────────────────────────────────────────────
-- Additive only. Nothing is dropped, renamed or rewritten.
--   * `JobPhoto.kind` is NOT NULL with a default, so the ALTER backfills every
--     existing row to GENERAL in one pass — the only row rewrite in this file,
--     and it writes the same value everywhere. On a table this size (job photos,
--     not events) that is a short exclusive lock.
--   * The five `ClientAddress` columns are NULLABLE with NO DEFAULT and NO
--     backfill, on purpose and for two reasons. "Not recorded" is the honest
--     state for every row that predates them; and 0 bedrooms / 0 sq ft is a
--     real answer a DEFAULT would forge. They are readable as "unknown" by
--     src/lib/property-size.ts, which is the only place that rule lives.
--     Backfilling them from each address's most recent job was considered and
--     rejected: a job's room counts are what was typed for THAT visit, and one
--     mistyped booking would become the customer's permanent property record.
--     The address book learns them the next time a job is saved at that door.
--   * No index is added for the property columns — nothing filters or sorts on
--     them. `JobPhoto` gains `(jobId, kind)`, which is exactly how the galleries
--     group and how the per-job cap counts.
-- No price, total, tax, payout, pay-rate or payment column is touched, and no
-- existing enum is altered.

CREATE TYPE "JobPhotoKind" AS ENUM ('BEFORE', 'AFTER', 'ISSUE', 'GENERAL');

ALTER TABLE "JobPhoto"
  ADD COLUMN "kind" "JobPhotoKind" NOT NULL DEFAULT 'GENERAL';

CREATE INDEX "JobPhoto_jobId_kind_idx" ON "JobPhoto"("jobId", "kind");

ALTER TABLE "ClientAddress"
  ADD COLUMN "propertyType"  "PropertyType",
  ADD COLUMN "bedCount"      INTEGER,
  ADD COLUMN "bathCount"     INTEGER,
  ADD COLUMN "halfBathCount" INTEGER,
  ADD COLUMN "squareFootage" INTEGER;
