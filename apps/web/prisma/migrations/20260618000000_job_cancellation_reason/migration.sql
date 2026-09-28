-- Customer-facing cancellation reason (additive, nullable). Shown in the
-- customer portal; distinct from internal NOTE_ADDED audit logs.
ALTER TABLE "Job" ADD COLUMN "cancellationReason" TEXT;
