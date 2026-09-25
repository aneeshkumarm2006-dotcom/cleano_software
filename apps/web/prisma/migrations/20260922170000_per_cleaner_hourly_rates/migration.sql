-- Sept 17 list, item 22: hourly pay has to support a different rate per cleaner.
--
-- Two nullable columns, no defaults and no backfill.
--
--   JobAssignment.hourlyRate  NULL = "use the job's crew-wide rate", which is
--                             what every existing row does today, so no job is
--                             repriced by this migration.
--   User.defaultHourlyRate    NULL = "no personal rate", and it only ever seeds
--                             the form — no pay calculation reads it.
--
-- Nothing is rewritten, so this is safe against a live database, and it
-- reverses by dropping the two columns.
ALTER TABLE "JobAssignment" ADD COLUMN "hourlyRate" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "defaultHourlyRate" DOUBLE PRECISION;
