-- Adds a notificationKey column to EmailLog for cron-driven idempotency.
ALTER TABLE "EmailLog" ADD COLUMN "notificationKey" TEXT;
CREATE INDEX "EmailLog_jobId_notificationKey_idx" ON "EmailLog"("jobId", "notificationKey");
