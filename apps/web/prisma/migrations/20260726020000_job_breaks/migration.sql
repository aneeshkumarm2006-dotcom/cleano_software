-- awer_fixes.pdf item 26 — cleaner break / pause while clocked in.
--
-- Breaks are ROWS, not a start/end column pair on JobAssignment: a cleaner can
-- legitimately take more than one break on a long job, and a single pair would
-- silently overwrite the earlier one. `endedAt` NULL means the break is running.

CREATE TABLE "JobBreak" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobBreak_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobBreak_jobId_cleanerId_idx" ON "JobBreak"("jobId", "cleanerId");
CREATE INDEX "JobBreak_cleanerId_idx" ON "JobBreak"("cleanerId");

ALTER TABLE "JobBreak" ADD CONSTRAINT "JobBreak_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobBreak" ADD CONSTRAINT "JobBreak_cleanerId_fkey"
  FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
