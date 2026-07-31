-- Real FAQ tables, replacing the content.faqs JSON blob
-- (CLN-P1-4-06 categories, 4-08 draft/publish + reorder, 4-09 category
--  management, 4-10 per-surface visibility, 4-11 EN/FR).
--
-- ⚠️ THIS IS THE ONE MIGRATION IN THE BATCH THAT MOVES DATA. It only ever
-- READS the AppSetting row — the blob is not modified and not deleted, because
-- getPublishedFaqs falls back to it when these tables are empty or absent. That
-- fallback is what keeps /faq and /help alive if the code ever ships ahead of
-- this migration.
--
-- Every insert below is guarded by NOT EXISTS, so re-running the file cannot
-- duplicate content.
--
-- The two silent-data-loss traps this has to avoid:
--
--   1. An admin who has NEVER opened the FAQ editor has no AppSetting row at
--      all — getSetting has been serving the registry defaults. Copying only
--      the row would insert nothing and both FAQ pages would go blank. Step 3
--      therefore seeds those two default entries verbatim when the row is
--      absent.
--   2. Migrated questions land UNCATEGORISED on purpose. Guessing which of the
--      ten spec categories a free-text question belongs to would silently
--      misfile the client's own content; an admin assigns them in the editor.
--
-- Ids are generated with md5(random()...) rather than gen_random_uuid() so the
-- migration needs no extension on the target database.
--
-- PRE-FLIGHT (both should return 0 — the tables must not already exist):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('Faq','FaqCategory');
--   -- and see what is about to be copied:
--   SELECT jsonb_array_length(value) FROM "AppSetting" WHERE key = 'content.faqs';
--
-- POST-APPLY VERIFICATION:
--   SELECT count(*) FROM "FaqCategory";   -- expect 10
--   -- expect the same count the pre-flight printed, or 2 if there was no row:
--   SELECT count(*) FROM "Faq";
--   SELECT count(*) FROM "Faq" WHERE status <> 'PUBLISHED' OR visibility <> 'BOTH';  -- expect 0
--   SELECT key FROM "AppSetting" WHERE key = 'content.faqs';  -- must STILL be there
--
-- ROLLBACK (the AppSetting blob is untouched, so nothing is lost):
--   DROP TABLE "Faq";
--   DROP TABLE "FaqCategory";
--   DROP TYPE "FaqStatus";
--   DROP TYPE "FaqVisibility";

CREATE TYPE "FaqStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "FaqVisibility" AS ENUM ('PUBLIC', 'PORTAL', 'BOTH');

CREATE TABLE "FaqCategory" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "nameFr"    TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FaqCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Faq" (
    "id"         TEXT NOT NULL,
    "categoryId" TEXT,
    "question"   TEXT NOT NULL,
    "answer"     TEXT NOT NULL,
    "questionFr" TEXT,
    "answerFr"   TEXT,
    "status"     "FaqStatus" NOT NULL DEFAULT 'PUBLISHED',
    "visibility" "FaqVisibility" NOT NULL DEFAULT 'BOTH',
    "sortOrder"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Faq_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FaqCategory_sortOrder_idx" ON "FaqCategory"("sortOrder");
CREATE INDEX "Faq_status_visibility_idx" ON "Faq"("status", "visibility");
CREATE INDEX "Faq_categoryId_sortOrder_idx" ON "Faq"("categoryId", "sortOrder");

-- SetNull, not Cascade: deleting a category must never destroy the questions
-- inside it. They become uncategorised and both surfaces render them last.
ALTER TABLE "Faq"
  ADD CONSTRAINT "Faq_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "FaqCategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 1. The ten categories the spec names, in the order it names them.
INSERT INTO "FaqCategory" ("id", "name", "sortOrder", "createdAt", "updatedAt")
SELECT
  'faqcat_' || md5('cleano-faq-category-' || c.name),
  c.name,
  c.ord,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (VALUES
  ('Booking', 0),
  ('Pricing', 1),
  ('Payments', 2),
  ('Cleaning Services', 3),
  ('Add-ons', 4),
  ('Rescheduling and Cancellations', 5),
  ('Cleaner Arrival and Access', 6),
  ('Supplies and Equipment', 7),
  ('Recurring Services', 8),
  ('Customer Accounts', 9)
) AS c(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM "FaqCategory");

-- 2. Copy whatever the admin has actually saved. Order is preserved through
--    WITH ORDINALITY so the list reads the same as it did on /faq yesterday.
--    PUBLISHED + BOTH are the column defaults, which is exactly how a JSON
--    entry behaved: live, on every surface.
INSERT INTO "Faq" ("id", "question", "answer", "sortOrder", "createdAt", "updatedAt")
SELECT
  'faq_' || md5(random()::text || clock_timestamp()::text || t.ord::text),
  trim(t.item ->> 'question'),
  trim(t.item ->> 'answer'),
  (t.ord - 1)::int,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "AppSetting" s
CROSS JOIN LATERAL jsonb_array_elements(s.value) WITH ORDINALITY AS t(item, ord)
WHERE s.key = 'content.faqs'
  AND jsonb_typeof(s.value) = 'array'
  AND coalesce(trim(t.item ->> 'question'), '') <> ''
  AND coalesce(trim(t.item ->> 'answer'), '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "Faq");

-- 3. No saved row means the pages have been rendering the registry defaults all
--    along. Seed them verbatim so the migration cannot blank the FAQ.
INSERT INTO "Faq" ("id", "question", "answer", "sortOrder", "createdAt", "updatedAt")
SELECT
  'faq_' || md5(random()::text || clock_timestamp()::text || d.ord::text),
  d.question,
  d.answer,
  d.ord,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (VALUES
  ('What areas do you serve?',
   'We serve the Greater Montreal area. Enter your postal code on the booking page to confirm coverage.',
   0),
  ('How do I reschedule or cancel?',
   'You can request a reschedule or cancellation from your customer portal. Cancellations close to your appointment may incur a fee.',
   1)
) AS d(question, answer, ord)
WHERE NOT EXISTS (SELECT 1 FROM "Faq");
