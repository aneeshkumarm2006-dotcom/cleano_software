-- Three-strike cleaner accountability system.

-- New AlertType for the 3-strike admin-review flag.
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'CLEANER_STRIKE';

-- Strike enums.
CREATE TYPE "StrikeReason" AS ENUM (
  'LATE_45', 'NO_SHOW', 'LOW_RATINGS_CONSECUTIVE', 'REFUND_COMPLAINT',
  'LATE_CANCEL', 'JOB_ABANDONMENT', 'FALSIFIED_CLOCK', 'CHECKLIST_FAILURE',
  'UNAPPROVED_PERSON', 'MISCONDUCT', 'MANUAL'
);
CREATE TYPE "StrikeStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'EXCUSED', 'REMOVED');

CREATE TABLE "CleanerStrike" (
  "id"          TEXT NOT NULL,
  "cleanerId"   TEXT NOT NULL,
  "reasonCode"  "StrikeReason" NOT NULL,
  "reason"      TEXT NOT NULL,
  "jobId"       TEXT,
  "status"      "StrikeStatus" NOT NULL DEFAULT 'ACTIVE',
  "isAuto"      BOOLEAN NOT NULL DEFAULT true,
  "appliedById" TEXT,
  "adminNote"   TEXT,
  "excusedById" TEXT,
  "excusedAt"   TIMESTAMP(3),
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CleanerStrike_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CleanerStrike_cleanerId_idx" ON "CleanerStrike"("cleanerId");
CREATE INDEX "CleanerStrike_status_idx" ON "CleanerStrike"("status");
CREATE INDEX "CleanerStrike_jobId_idx" ON "CleanerStrike"("jobId");
CREATE INDEX "CleanerStrike_expiresAt_idx" ON "CleanerStrike"("expiresAt");

ALTER TABLE "CleanerStrike" ADD CONSTRAINT "CleanerStrike_cleanerId_fkey"
  FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CleanerStrike" ADD CONSTRAINT "CleanerStrike_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
