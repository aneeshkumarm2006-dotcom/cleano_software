-- Add new job statuses to the enum
-- Note: ALTER TYPE ADD VALUE cannot be run inside a transaction block in PostgreSQL
-- This migration adds CREATED and SCHEDULED statuses

-- Add CREATED status (to be used for newly created jobs)
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'CREATED';

-- Add SCHEDULED status (to be used when cleaners are assigned)
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

-- Update the default value for the status column
-- Note: This only affects new records, existing records remain unchanged
ALTER TABLE "Job" ALTER COLUMN "status" SET DEFAULT 'CREATED'::"JobStatus";


