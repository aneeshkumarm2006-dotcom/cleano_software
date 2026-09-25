-- Multi-touch lead follow-up sequences (AI assistant). Additive; existing
-- leads start at zero touches, which is the truth.
ALTER TABLE "Lead" ADD COLUMN "followUpCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN "lastFollowUpAt" TIMESTAMP(3);
