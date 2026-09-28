-- Client feedback item 20 (Stage 11.2) — commissions on sales reps.
--
--   "for sales leads, I wanted to add another section over here that is for
--    commissions, for commissions on sales reps etc. If we're paying them any
--    commissions, we could track it over here."
--
-- Additive: one new table, no existing column touched.
--
-- `paidAt` is the status column — NULL is pending, a timestamp is paid. A rep's
-- pending and paid totals are the two sums either side of it, so there is no
-- enum to keep in step with a boolean.
--
-- `period` is the "YYYY-MM" payout bucket, the same shape as "Budget"."period",
-- written from `storeMonthPeriod()` so a commission entered at 9 PM on the last
-- of the month lands in that month and not the next one (the server clock is
-- UTC; the store is Montréal).
--
-- ON DELETE RESTRICT on the rep, deliberately, where the other User relations
-- cascade: these rows are money owed to a person. A cascade would let deleting
-- an employee silently erase their unpaid commission history. `deleteEmployee`
-- checks for commissions and says so, the same way it already refuses to delete
-- someone who still has jobs. Job and Lead are SET NULL — the commission stays
-- payable even if what it was earned on is removed.
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "salesRepId" TEXT NOT NULL,
    "jobId" TEXT,
    "leadId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION,
    "note" TEXT,
    "period" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Commission_salesRepId_idx" ON "Commission"("salesRepId");
CREATE INDEX "Commission_period_idx" ON "Commission"("period");
CREATE INDEX "Commission_paidAt_idx" ON "Commission"("paidAt");
CREATE INDEX "Commission_jobId_idx" ON "Commission"("jobId");
CREATE INDEX "Commission_leadId_idx" ON "Commission"("leadId");

ALTER TABLE "Commission" ADD CONSTRAINT "Commission_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
