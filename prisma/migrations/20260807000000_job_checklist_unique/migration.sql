-- awerfixes.pdf item 5 (round 3) — one checklist per cleaner per job.
--
-- Generation used to happen only when somebody pressed "Generate Checklist".
-- It now fires when the assigned cleaner OPENS the job, so the read-then-write
-- race in ensureJobChecklist stops being theoretical: two concurrent renders
-- can both miss the lookup and both create. This constraint makes the loser
-- fail with P2002 (the store catches it and re-reads the winner) instead of
-- silently writing a second checklist that half the app would never see.
--
-- Safe to apply: `scripts/probe-stage5.ts` counted 0 duplicate
-- (jobId, employeeId) pairs on live before this was written. The index is
-- created concurrently-safe via IF NOT EXISTS so a re-run is a no-op.

CREATE UNIQUE INDEX IF NOT EXISTS "JobChecklist_jobId_employeeId_key"
  ON "JobChecklist"("jobId", "employeeId");
