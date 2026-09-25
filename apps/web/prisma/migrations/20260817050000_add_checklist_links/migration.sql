-- Stage 10 of `_ai_context/TODO.md` — customer / contract-specific checklists
-- (cleano_inventory_operations_fixes.pdf #10, p.7). Implements step 10.1.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- A ChecklistTemplate could only be scoped two ways: to a SERVICE TYPE
-- (`jobType`) or to an ADD-ON (`addOnName`). There was no way to say "every
-- Mckiernan job gets the strict Mckiernan restaurant checklist" — the closest
-- available move was to edit the COMMERCIAL default, which would have changed
-- the checklist for every other commercial customer at the same time. Nor was
-- there any way to pin one individual job, or one recurring series, to a
-- specific list.
--
-- This migration adds the two-layer link decision D9 chose:
--
--   1. TEMPLATE SCOPING — `ChecklistTemplate.clientId` / `.clientAddressId`.
--      Set-and-forget: the template auto-attaches to that customer's jobs (or
--      that one location's jobs) without anybody touching an individual job.
--   2. PER-JOB OVERRIDE — `Job.checklistTemplateId`. Pins one job to one
--      template, and rides the recurring-series allowlist so a series stays
--      consistent as its children are generated.
--
-- Resolution precedence (one place, src/lib/checklist-triggers.ts):
--   job pin → address-scoped → client-scoped → jobType/add-on default → none.
-- Specific beats general and REPLACES it — the PDF is explicit that a custom
-- checklist "should override the default service-type checklist", not stack on
-- top of it.
--
-- ── Blast radius ───────────────────────────────────────────────────────────
-- Additive only. Three nullable columns, three FKs, three indexes. Nothing is
-- rewritten, nothing is dropped, no enum is touched, and no price, total, tax,
-- payout or payment column appears anywhere in this file.
--   * Every existing ChecklistTemplate row keeps clientId = clientAddressId =
--     NULL, which is exactly "not scoped to a customer" — so the jobType /
--     add-on matching that exists today keeps producing byte-identical results.
--   * Every existing Job row keeps checklistTemplateId = NULL, which means
--     "resolve automatically" — again today's behaviour.
--   * No backfill, and none is possible: nothing stored can tell which of a
--     customer's jobs was meant to have a bespoke list. Admins link templates
--     by hand from Settings → Checklist Templates.
--
-- ── FK delete rules, and why they differ ───────────────────────────────────
-- ChecklistTemplate.clientId → ON DELETE CASCADE.
--   SetNull here would be a live hazard, not a convenience: nulling the column
--   does not retire the template, it PROMOTES it. A strict single-customer
--   checklist would silently become a global one firing on every job in the
--   business. Cascade is also cheap in practice — `deleteClient` refuses while
--   any job is linked, so it can only ever fire for a client with no history.
--
-- ChecklistTemplate.clientAddressId → ON DELETE SET NULL.
--   Safe precisely because the editor and both server actions guarantee
--   `clientId` is set whenever `clientAddressId` is. Deleting the address
--   therefore degrades the template from "Mckiernan — 12 Main St" to
--   "Mckiernan — all locations" instead of making it global. Deleting one
--   address out of an address book must not destroy a template and its items.
--
-- Job.checklistTemplateId → ON DELETE SET NULL.
--   Deleting a template returns the pinned jobs to automatic resolution. The
--   alternative (cascade) would delete jobs, which is obviously wrong.

ALTER TABLE "ChecklistTemplate"
  ADD COLUMN "clientId" TEXT,
  ADD COLUMN "clientAddressId" TEXT;

ALTER TABLE "Job"
  ADD COLUMN "checklistTemplateId" TEXT;

-- Indexes. Unlike Stage 9's propertyType (two values — never selective enough
-- for the planner) these are FK lookups on high-cardinality cuids, and the
-- resolver filters templates by client on the cleaner's job-open path.
CREATE INDEX "ChecklistTemplate_clientId_idx" ON "ChecklistTemplate"("clientId");
CREATE INDEX "ChecklistTemplate_clientAddressId_idx" ON "ChecklistTemplate"("clientAddressId");
CREATE INDEX "Job_checklistTemplateId_idx" ON "Job"("checklistTemplateId");

ALTER TABLE "ChecklistTemplate"
  ADD CONSTRAINT "ChecklistTemplate_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistTemplate"
  ADD CONSTRAINT "ChecklistTemplate_clientAddressId_fkey"
  FOREIGN KEY ("clientAddressId") REFERENCES "ClientAddress"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_checklistTemplateId_fkey"
  FOREIGN KEY ("checklistTemplateId") REFERENCES "ChecklistTemplate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
