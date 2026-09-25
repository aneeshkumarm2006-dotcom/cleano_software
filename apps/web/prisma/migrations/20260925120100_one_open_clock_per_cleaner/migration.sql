-- One running work session, and one running break, per cleaner per job
-- (API_V1.md §5, "It is race-safe").
--
-- Two taps, or two devices, can both see "not clocked in" and both open a
-- session; the clock actions check first and write second. These partial
-- unique indexes make the database refuse the second one, so the loser of the
-- race is answered with the winner's session instead of a duplicate.
--
-- Kept apart from the foundation migration on purpose: an index cannot be
-- built over rows that already break it, and if any do, this one should stop
-- on its own with a clear message while the additive columns ship.
--
-- Prisma's schema language cannot express a partial index, so these live here
-- only. `prisma migrate diff` against a live database will list them as extra;
-- that is expected.

DO $$
DECLARE
  open_sessions INT;
  open_breaks   INT;
BEGIN
  SELECT count(*) INTO open_sessions FROM (
    SELECT 1 FROM "JobWorkSession" WHERE "endedAt" IS NULL
    GROUP BY "jobId", "cleanerId" HAVING count(*) > 1
  ) d;
  SELECT count(*) INTO open_breaks FROM (
    SELECT 1 FROM "JobBreak" WHERE "endedAt" IS NULL
    GROUP BY "jobId", "cleanerId" HAVING count(*) > 1
  ) d;
  IF open_sessions > 0 OR open_breaks > 0 THEN
    RAISE EXCEPTION
      'Refusing to add one-open-clock indexes: % (job, cleaner) pairs with several open sessions, % with several open breaks. Close the extras by hand (admin clock edit), then re-run.',
      open_sessions, open_breaks;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "JobWorkSession_one_open_per_cleaner"
  ON "JobWorkSession" ("jobId", "cleanerId") WHERE "endedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "JobBreak_one_open_per_cleaner"
  ON "JobBreak" ("jobId", "cleanerId") WHERE "endedAt" IS NULL;
