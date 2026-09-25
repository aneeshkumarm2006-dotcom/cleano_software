-- Cleaner job-application intake.
CREATE TYPE "JobApplicationStatus" AS ENUM ('NEW', 'CONTACTED', 'INTERVIEWING', 'HIRED', 'REJECTED', 'ARCHIVED');

CREATE TABLE "JobApplication" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "phone"        TEXT,
  "cityArea"     TEXT,
  "availability" TEXT,
  "experience"   TEXT,
  "hasTransport" BOOLEAN,
  "resumeUrl"    TEXT,
  "status"       "JobApplicationStatus" NOT NULL DEFAULT 'NEW',
  "notes"        TEXT,
  "source"       TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobApplication_status_idx" ON "JobApplication"("status");
CREATE INDEX "JobApplication_createdAt_idx" ON "JobApplication"("createdAt");
