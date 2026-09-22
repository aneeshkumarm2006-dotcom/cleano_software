-- Sept 10 fix list, items 8 and 13.
--
-- Both columns are NULLABLE with no default and no backfill, on purpose:
--   • NULL on `recurringDiscountMode` means "AUTO", which is exactly what
--     every existing recurring job already does, so no row changes behaviour.
--   • NULL on `dismissedAt` means "not archived", which is what every existing
--     notification-read row already is.
--
-- Nothing is rewritten, so this is safe to run against a live database while
-- the app is serving, and it is reversible by dropping the three columns.

-- Item 8: whether a recurring series gets the frequency discount at all.
ALTER TABLE "Job" ADD COLUMN "recurringDiscountMode" TEXT;
ALTER TABLE "Job" ADD COLUMN "recurringDiscountPercentOverride" DOUBLE PRECISION;

-- Item 13: archiving a notification, per person.
ALTER TABLE "NotificationRead" ADD COLUMN "dismissedAt" TIMESTAMP(3);
