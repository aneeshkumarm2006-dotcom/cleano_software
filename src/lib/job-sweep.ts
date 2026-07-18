import "server-only";
import { db } from "@/db";
import { startOfDayTz } from "./time";

// Spec item 8: jobs move Scheduled → Completed once the job date has passed
// (on July 16, every unpaid July 15 job reads Completed), and jobs whose
// payment was already received land on Paid — never downgraded. Runs from the
// 5-minute cron; both updates are cheap indexed updateMany calls, so it's safe
// to run often. Display already derives the same answer via simpleJobStatus(),
// this sweep just makes the stored rows catch up for SQL-side filters/counts.
export async function sweepPastScheduledJobs(now: Date = new Date()): Promise<{
  completed: number;
  paid: number;
}> {
  const dayStart = startOfDayTz(now);
  const pastUnfinished = {
    deletedAt: null,
    status: { in: ["CREATED", "SCHEDULED", "IN_PROGRESS"] as ("CREATED" | "SCHEDULED" | "IN_PROGRESS")[] },
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
