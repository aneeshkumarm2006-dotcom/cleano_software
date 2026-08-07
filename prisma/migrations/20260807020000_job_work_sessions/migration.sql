-- awerfixes.pdf item 6 (round 3) — clock back into a job.
--
-- Work is now ROWS, not a single clockInTime/clockOutTime pair, for the same
-- reason breaks are (see 20260726020000_job_breaks): a cleaner can leave and
-- come back, and one pair can only hold the last stretch.
--
-- The pair also lived on the JOB rather than per cleaner, which made two real
-- bugs inevitable on any multi-cleaner job:
--   * the first cleaner to clock in blocked every teammate ("Already clocked
--     in"), because the guard read Job.clockInTime;
--   * the first cleaner to clock OUT completed the job for the whole crew.
-- Sessions are keyed (jobId, cleanerId), so both go away.
--
-- NOT foreign-keyed to JobAssignment on purpose: syncJobAssignments deletes
-- non-CANCELLED assignment rows when an admin removes a cleaner from a job,
-- which would cascade away the record of work they had already done.
--
-- Job.clockInTime / Job.clockOutTime and the JobAssignment pair are KEPT and
-- maintained as derived mirrors — every existing reader keeps working, and jobs
-- that predate this table still report from the pair via the legacy fallback in
-- src/lib/work-sessions.ts. No backfill is required for correctness; a dry-run
-- backfill script ships alongside (scripts/backfillJobWorkSessions.ts).

CREATE TABLE IF NOT EXISTS "JobWorkSession" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobWorkSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JobWorkSession_jobId_cleanerId_idx"
  ON "JobWorkSession"("jobId", "cleanerId");
CREATE INDEX IF NOT EXISTS "JobWorkSession_cleanerId_idx"
  ON "JobWorkSession"("cleanerId");

DO $$ BEGIN
  ALTER TABLE "JobWorkSession" ADD CONSTRAINT "JobWorkSession_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "JobWorkSession" ADD CONSTRAINT "JobWorkSession_cleanerId_fkey"
    FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
