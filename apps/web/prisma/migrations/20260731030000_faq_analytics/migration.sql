-- FAQ analytics events (CLN-P1-4-17).
--
-- One append-only table. Nothing else in the schema is touched, so this
-- migration cannot affect a single existing row.
--
-- The requirement lists four metrics; two of them are the same signal on an
-- accordion, and that interpretation is recorded here rather than papered over:
--
--   "most-viewed questions"      → OPEN  ┐ identical. A question is only ever
--   "questions opened most often" → OPEN ┘ "viewed" by being expanded, and
--                                          logging an impression per rendered
--                                          question would produce ~20 rows per
--                                          page load and measure traffic, not
--                                          interest.
--   "popular searches"            → SEARCH (client-side 700ms debounce, so one
--                                           search is one row, not one per
--                                           keystroke)
--   "searches with no results"    → SEARCH_NO_RESULT
--
-- VIEW is one row per FAQ page load (faqId NULL) and serves as the denominator.
--
-- faqId is ON DELETE SET NULL: deleting a question must not rewrite history and
-- erase the traffic it once had.
--
-- ⚠️ NOTE FOR WHOEVER APPLIES THIS: the write path behind this table is
-- reachable from the PUBLIC /faq page and is therefore unauthenticated and
-- unmetered — the same gap that already exists on /api/stripe/charge-deposit
-- and lead/quote submission. It is bounded (4-value enum, FK-checked id,
-- 80-char query, fire-and-forget) but it is not rate limited. Deliberately not
-- "fixed" here: rate limiting is a separate ticket across all of those
-- endpoints. If FAQ traffic ever needs pruning:
--   DELETE FROM "FaqEvent" WHERE "createdAt" < now() - interval '1 year';
--
-- PRE-FLIGHT (should return 0):
--   SELECT count(*) FROM information_schema.tables WHERE table_name = 'FaqEvent';
--
-- POST-APPLY VERIFICATION:
--   SELECT count(*) FROM "FaqEvent";                    -- expect 0
--   SELECT unnest(enum_range(NULL::"FaqEventType"));    -- expect the 4 values
--
-- ROLLBACK (destroys only analytics collected after the apply — no FAQ content):
--   DROP TABLE "FaqEvent";
--   DROP TYPE "FaqEventType";

CREATE TYPE "FaqEventType" AS ENUM ('VIEW', 'OPEN', 'SEARCH', 'SEARCH_NO_RESULT');

CREATE TABLE "FaqEvent" (
    "id"        TEXT NOT NULL,
    "type"      "FaqEventType" NOT NULL,
    "faqId"     TEXT,
    "query"     TEXT,
    "surface"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FaqEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FaqEvent_type_createdAt_idx" ON "FaqEvent"("type", "createdAt");
CREATE INDEX "FaqEvent_faqId_type_idx" ON "FaqEvent"("faqId", "type");
CREATE INDEX "FaqEvent_query_idx" ON "FaqEvent"("query");

ALTER TABLE "FaqEvent"
  ADD CONSTRAINT "FaqEvent_faqId_fkey"
  FOREIGN KEY ("faqId") REFERENCES "Faq"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
