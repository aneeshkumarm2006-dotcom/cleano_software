-- awer_fixes.pdf item 7 — per-job sales tax exemption.
--
-- Admin can mark an individual job tax-exempt so GST/QST are not added to that
-- job's total. Scoped to the single job: there is deliberately no global
-- switch here. Existing jobs default to taxed, which preserves current totals.
--
-- Separate from `isCashJob`: that is a PAYMENT METHOD which happens to be
-- untaxed, whereas this is a tax status. A job can be card-paid and exempt.

ALTER TABLE "Job" ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT false;
