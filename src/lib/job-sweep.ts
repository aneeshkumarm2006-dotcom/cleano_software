import "server-only";
import { db } from "@/db";
import { startOfDayTz } from "./time";

// Spec item 8: jobs move Scheduled → Completed once the job date has passed
// (on July 16, every unpaid July 15 job reads Completed), and jobs whose
// payment was already received land on Paid — never downgraded. Runs from the
// 5-minute cron; both updates are cheap indexed updateMany calls, so it's safe
// to run often. Display already derives the same answer via simpleJobStatus(),
// this sweep just makes the stored rows catch up for SQL-side filters/counts.
//
// ── Round 4, fix 6 — CREATED is no longer swept ───────────────────────────
// `CREATED` used to be in the list below, back when it was just the Prisma
// default that every admin-created job fell to. It now MEANS on hold (saveJob
// stamps SCHEDULED explicitly), and a hold is a statement about the AGREEMENT,
// which the calendar cannot settle: an import nobody priced does not become
// finished work by being left alone overnight. This sweep was the only thing
// that ever moved a held job, and what it moved it to was a green "Completed"
// pill — the same "completion inferred from something that isn't completion"
// that fix 1 is about, one table over.
//
// So a hold now survives its own date and waits for `releaseJobHold` (or the
// Cancel flow). It stays reachable the whole time: `jobStatusWhere("onhold")`
// and the Jobs page's On-hold tab have no date test either, precisely so a hold
// that has gone stale is the easiest thing on the page to find.
export async function sweepPastScheduledJobs(now: Date = new Date()): Promise<{
  completed: number;
  paid: number;
}> {
  const dayStart = startOfDayTz(now);
  const pastUnfinished = {
    deletedAt: null,
    status: { in: ["SCHEDULED", "IN_PROGRESS"] as ("SCHEDULED" | "IN_PROGRESS")[] },
    startTime: { lt: dayStart },
  };
  const [paid, completed] = await db.$transaction([
    db.job.updateMany({
      where: { ...pastUnfinished, paymentReceived: true },
      data: { status: "PAID" },
    }),
    db.job.updateMany({
      where: { ...pastUnfinished, paymentReceived: false },
      data: { status: "COMPLETED" },
    }),
  ]);
  return { completed: completed.count, paid: paid.count };
}
