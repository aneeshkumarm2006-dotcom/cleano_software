-- Recurring-service cancellation + save-offer tracking.
CREATE TABLE "RecurringCancellation" (
  "id"            TEXT NOT NULL,
  "clientId"      TEXT NOT NULL,
  "frequency"     TEXT,
  "reason"        TEXT,
  "cancelledAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailSentAt"   TIMESTAMP(3),
  "offerType"     TEXT,
  "offerValue"    DOUBLE PRECISION,
  "offerCode"     TEXT,
  "offerStatus"   TEXT NOT NULL DEFAULT 'PENDING',
  "openedAt"      TIMESTAMP(3),
  "clickedAt"     TIMESTAMP(3),
  "repliedAt"     TIMESTAMP(3),
  "reactivatedAt" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringCancellation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecurringCancellation_clientId_idx" ON "RecurringCancellation"("clientId");
CREATE INDEX "RecurringCancellation_offerStatus_idx" ON "RecurringCancellation"("offerStatus");
CREATE INDEX "RecurringCancellation_cancelledAt_idx" ON "RecurringCancellation"("cancelledAt");
ALTER TABLE "RecurringCancellation" ADD CONSTRAINT "RecurringCancellation_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
