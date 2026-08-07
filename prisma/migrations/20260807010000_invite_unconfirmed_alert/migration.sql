-- awerfixes.pdf item 4 (round 3) — kill the 10-minute "pending assignment".
--
-- A DIRECT assignment invite (isLastMinute = false) never lapses: the cleaner is
-- already on the job, and since AWER_NEW_FIXES item 2 expiry does not unassign
-- anybody. The cron sweep nevertheless stamped those rows EXPIRED (and stamped
-- respondedAt, for a response that never happened), which is where the whole
-- "pending / expires in X min" framing came from.
--
-- The sweep now leaves direct invites alone and only raises the admin
-- "assignment unconfirmed" WARNING. That alert needs its own dedupe marker,
-- because it no longer has a decision change to key off and notifyAdmins() has
-- no dedupe of its own — without this column the admin would be re-alerted on
-- every cron run, forever.
--
-- Additive and nullable: existing rows read as "not yet alerted", which is the
-- correct starting state. Last-minute broadcasts leave it null and keep hard
-- expiry.

ALTER TABLE "JobAssignmentInvite"
  ADD COLUMN IF NOT EXISTS "unconfirmedAlertAt" TIMESTAMP(3);
