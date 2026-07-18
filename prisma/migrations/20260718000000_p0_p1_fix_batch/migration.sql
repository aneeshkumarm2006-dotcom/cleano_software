-- P0/P1 fix batch (softwarefixes spec, July 18 2026):
-- consolidated multi-job invoices, after-photos allowed by default,
-- real document access log.

-- Item 10: consolidated invoices — link each invoice line to its job so
-- marking the invoice paid can flip every covered job to Paid.
ALTER TABLE "InvoiceLineItem" ADD COLUMN "jobId" TEXT;
CREATE INDEX "InvoiceLineItem_jobId_idx" ON "InvoiceLineItem"("jobId");
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Item 21: after-photos are allowed by default; the flag becomes an opt-out.
-- Existing jobs (imported and manual) all had the old default false, which is
-- exactly the blanket block the spec removes — open them all up.
ALTER TABLE "Job" ALTER COLUMN "afterPhotoConsent" SET DEFAULT true;
UPDATE "Job" SET "afterPhotoConsent" = true WHERE "afterPhotoConsent" = false;

-- Item 20: real document access activity (open / view / download / complete).
CREATE TABLE "DocumentAccessLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentAccessLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentAccessLog_documentId_createdAt_idx" ON "DocumentAccessLog"("documentId", "createdAt");
CREATE INDEX "DocumentAccessLog_userId_createdAt_idx" ON "DocumentAccessLog"("userId", "createdAt");
CREATE INDEX "DocumentAccessLog_createdAt_idx" ON "DocumentAccessLog"("createdAt");
ALTER TABLE "DocumentAccessLog" ADD CONSTRAINT "DocumentAccessLog_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentAccessLog" ADD CONSTRAINT "DocumentAccessLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
