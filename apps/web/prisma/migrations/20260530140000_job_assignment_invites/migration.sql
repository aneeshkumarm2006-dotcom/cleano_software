-- Accept / decline workflow for cleaner assignments.

DO $$ BEGIN
  CREATE TYPE "JobInviteDecision" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "JobAssignmentInvite" (
  "id"            TEXT PRIMARY KEY,
  "jobId"         TEXT NOT NULL,
  "cleanerId"     TEXT NOT NULL,
  "decision"      "JobInviteDecision" NOT NULL DEFAULT 'PENDING',
  "sentAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt"   TIMESTAMP(3),
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "declineReason" TEXT,
  "isLastMinute"  BOOLEAN NOT NULL DEFAULT false,
  "bonusUsd"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JobAssignmentInvite_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE,
  CONSTRAINT "JobAssignmentInvite_cleanerId_fkey"
    FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "JobAssignmentInvite_jobId_cleanerId_key"
  ON "JobAssignmentInvite"("jobId", "cleanerId");
CREATE INDEX IF NOT EXISTS "JobAssignmentInvite_cleanerId_decision_idx"
  ON "JobAssignmentInvite"("cleanerId", "decision");
CREATE INDEX IF NOT EXISTS "JobAssignmentInvite_expiresAt_idx"
  ON "JobAssignmentInvite"("expiresAt");
