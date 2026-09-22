-- Sept 17 list, item 13: rating history has to say where each rating came from.
--
-- One nullable column, no default and no backfill. NULL means "work it out from
-- jobId", which is what every existing row needs and what lib/rating-history.ts
-- does. Nothing is rewritten, so this is safe against a live database, and it
-- reverses by dropping the column.
ALTER TABLE "EmployeeRating" ADD COLUMN "source" TEXT;
