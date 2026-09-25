-- awerfixes.pdf item 16 (round 3) — void cheque / direct deposit upload.
--
-- A new table rather than columns on "User", for three reasons:
--   * the item asks for HISTORY ("history rows kept, newest = current"), and a
--     column can only hold the latest value. Replacing a cheque appends a row,
--     so swapping banking details is never silent;
--   * banking artefacts are the kind of thing that grows a second and third
--     variety (T4, signed direct-deposit form). `kind` is a TEXT discriminator,
--     not an enum, so the next one costs no migration;
--   * "User" is read on nearly every request. Payroll paperwork is read on two
--     pages, and it should not ride along in every session lookup.
--
-- Additive and empty on arrival: no backfill, nothing to migrate, and no
-- existing query changes behaviour. Deploying this before the code is a no-op.
--
-- PRIVACY (decision 7, _ai_context/TODO.md:92-95). "fileUrl" holds a Cloudinary
-- `type: authenticated` URL, which is REFUSED without a signature — the column
-- is not a back door. "publicId" and "resourceType" are stored because minting
-- the short-lived signed URL needs both, and the repo's only URL→public-id
-- parser (deleteJobPhoto.ts) hardcodes an `/upload/` segment that an
-- authenticated delivery URL does not contain.
--
-- ON DELETE CASCADE: removing an employee removes their banking paperwork. That
-- is the intent — this is the one table where orphaned rows would be a liability
-- rather than a stray record.
--
-- PRE-FLIGHT (should return 0 — the table must not already exist):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name = 'EmployeeFile';
--
-- POST-APPLY VERIFICATION (expect 9 columns; resourceType defaults to 'image',
-- every other column NOT NULL except none — all are required):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'EmployeeFile' ORDER BY ordinal_position;
--   -- and the index + FK:
--   SELECT indexname FROM pg_indexes WHERE tablename = 'EmployeeFile';
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = '"EmployeeFile"'::regclass AND contype = 'f';
--
-- ROLLBACK (safe while the table is empty; destructive once cheques exist):
--   DROP TABLE "EmployeeFile";

CREATE TABLE IF NOT EXISTS "EmployeeFile" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL DEFAULT 'image',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeFile_pkey" PRIMARY KEY ("id")
);

-- The only read this table serves is "newest file of this kind for this
-- employee", on the cleaner's Documents page and the admin employee detail.
CREATE INDEX IF NOT EXISTS "EmployeeFile_employeeId_kind_uploadedAt_idx"
  ON "EmployeeFile"("employeeId", "kind", "uploadedAt");

DO $$ BEGIN
  ALTER TABLE "EmployeeFile" ADD CONSTRAINT "EmployeeFile_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
