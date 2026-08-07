-- awerfixes.pdf item 2 (round 3, stage 4) — multiple saved addresses per client.
--
-- THREE PARTS, and part 1 needs explaining before the rest makes sense.
--
-- PART 1 — history backfill, not a new table.
--   `ClientAddress` already exists on the deployed database and in
--   schema.prisma, but it was created with `prisma db push` and NEVER captured
--   in migration history: `grep -ril ClientAddress prisma/migrations` matched
--   nothing across all 64 prior migrations. (README.md still recommends
--   `db push` for local setup, which is how it drifted.) So a database rebuilt
--   from migrations alone has no such table, and parts 2 and 3 below would fail
--   against it.
--
--   Written idempotently for exactly the reason
--   20260728010000_align_schema_drift was: the deployed database already has
--   this object, so every statement here must be a no-op there while still
--   building the table from scratch on a fresh one. Same precedent, same style.
--
--   The column list is transcribed to match what `db push` generated from the
--   pre-existing model, so `migrate diff` sees no drift afterwards.
--
-- PART 2 — the three new address columns the PDF asks for.
--   `postalCode`, deliberately NOT `zip`. Client already carries a legacy flat
--   trio (address/city/state/zip) which is the customer's BILLING address;
--   these rows are the SERVICE address book. Two stores, two names, not merged.
--   `accessNotes` holds door/gate/buzzer codes and parking instructions — the
--   reason cleaners could not get into a building before this stage.
--
-- PART 3 — Job.clientAddressId, which is PROVENANCE and nothing more.
--   Jobs KEEP their denormalized `location`/`aptNumber` snapshot. This FK only
--   records which saved address a job was booked against, so the cleaner view
--   can read that address's accessNotes and so "apply to series" can carry the
--   choice forward. It is not the source of truth for where the job is.
--
--   ON DELETE SET NULL is the whole point: deleting a saved address must null
--   the pointer and leave every completed job — and the invoice already sent
--   for it — reading exactly as it did before. A cascade here would destroy
--   financial history. deleteClientAddress() hard-deletes today, so this is
--   load-bearing, not theoretical.
--
-- Two deliberate non-additions, so a later reader doesn't "fix" them:
--
--   * No UNIQUE (clientId, address). A client can legitimately have two rows at
--     one street with different units ("4820 Sherbrooke" apt 2 and apt 12), and
--     the same street may be re-saved under a different label. De-duplication
--     is a normalized-key lookup in upsertClientAddress()
--     (src/lib/client-address.ts) — including aptNumber, which the old inline
--     check in admin/jobs/new/page.tsx wrongly ignored — not a DB constraint
--     that would turn a legitimate save into a P2002.
--   * No partial unique index enforcing one isDefault per client. Prisma cannot
--     model a partial index, so it would read as permanent drift — and drift is
--     precisely why part 1 of this migration exists. The single-default rule
--     stays where it already lives: the `updateMany({ isDefault: false })`
--     demotion every write path performs first.
--
-- No backfill. Every existing ClientAddress row is correct with the three new
-- columns NULL, and every existing Job is correct with clientAddressId NULL —
-- a null FK means "booked before we tracked provenance", which is true.
-- Adding a nullable column with no default is catalog-only on Postgres, so
-- there is no table rewrite on any of these.

-- ── Part 1 · capture the drifted table in migration history ─────────────────
CREATE TABLE IF NOT EXISTS "ClientAddress" (
    "id"        TEXT NOT NULL,
    "clientId"  TEXT NOT NULL,
    "label"     TEXT NOT NULL DEFAULT 'Home',
    "address"   TEXT NOT NULL,
    "aptNumber" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAddress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClientAddress_clientId_idx" ON "ClientAddress"("clientId");

DO $$
BEGIN
    ALTER TABLE "ClientAddress"
        ADD CONSTRAINT "ClientAddress_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ── Part 2 · the new address detail columns ─────────────────────────────────
ALTER TABLE "ClientAddress" ADD COLUMN IF NOT EXISTS "city"        TEXT;
ALTER TABLE "ClientAddress" ADD COLUMN IF NOT EXISTS "postalCode"  TEXT;
ALTER TABLE "ClientAddress" ADD COLUMN IF NOT EXISTS "accessNotes" TEXT;

-- ── Part 3 · Job → ClientAddress provenance link ────────────────────────────
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "clientAddressId" TEXT;

CREATE INDEX IF NOT EXISTS "Job_clientAddressId_idx" ON "Job"("clientAddressId");

DO $$
BEGIN
    ALTER TABLE "Job"
        ADD CONSTRAINT "Job_clientAddressId_fkey"
        FOREIGN KEY ("clientAddressId") REFERENCES "ClientAddress"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
