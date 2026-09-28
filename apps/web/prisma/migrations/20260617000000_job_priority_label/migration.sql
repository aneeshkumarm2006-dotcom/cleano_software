-- Calendar priority badge override on a job.
-- NULL = follow the auto rule (calendar.jobTypeLabels setting); otherwise an
-- operations manager's explicit switch: 'ROUTINE' | 'IMPORTANT' | 'NONE'.
ALTER TABLE "Job" ADD COLUMN "priorityLabel" TEXT;
