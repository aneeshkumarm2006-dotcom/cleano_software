-- Soft-delete support for bulk actions (recoverable via Archived views)
ALTER TABLE "Job" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Waitlist" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "JobApplication" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "QuoteRequest" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "GiftCard" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "PromoCode" ADD COLUMN "deletedAt" TIMESTAMP(3);
