-- Sept 17 list, item 18: a checklist typed into one job, with no template.
--
-- One nullable column, no default and no backfill. NULL means "resolve a
-- template the way you always have", which is what every existing job needs,
-- so no job's checklist changes. Nothing is rewritten, so this is safe against
-- a live database, and it reverses by dropping the column.
ALTER TABLE "Job" ADD COLUMN "customChecklist" JSONB;
