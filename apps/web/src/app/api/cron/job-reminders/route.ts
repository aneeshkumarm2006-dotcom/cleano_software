import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/cron-auth";
import { forEachOrganization, summarise } from "@/lib/cron-tenants";
import { isNotificationEnabled } from "@/lib/notifications";
import { db } from "@/lib/org-db";
import { reminderWindow, sendJobReminders, type ReminderJob } from "@/server/push/core";
import { pushDeps } from "@/server/push/deps";
import { reminderNotice } from "@/server/push/notify";

/**
 * "Your job in <area> starts at 9:00 AM": a push to each person on a job about
 * an hour before it starts (server/push).
 *
 * Every 15 minutes, per company, the jobs starting 40 to 65 minutes from now:
 * consecutive runs overlap, so a late run misses nothing, and the
 * PushJobReminder marker (one per person, job and start) means nobody is
 * reminded twice. A job moved to a new start gets a new reminder. Cancelled,
 * finished and archived jobs are skipped, as are jobs whose provider
 * notifications are switched off and companies that switched the one-hour
 * reminder's push off. The time is the company's own (storeTz inside
 * forEachOrganization).
 *
 * vercel.json: { "path": "/api/cron/job-reminders", "schedule": "*\/15 * * * *" }
 */
const MAX_JOBS_PER_RUN = 500;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await forEachOrganization(async () => {
    if (!(await isNotificationEnabled("PROVIDER", "prov.reminders.one_hour", "APP_PUSH"))) {
      return { jobs: 0, people: 0, sent: 0, off: true };
    }
    const { from, to } = reminderWindow(new Date());
    const jobs = await db.job.findMany({
      where: {
        deletedAt: null,
        notifyProvider: true,
        status: { notIn: ["CANCELLED", "COMPLETED", "PAID"] },
        startTime: { gt: from, lte: to },
      },
      select: {
        id: true,
        startTime: true,
        location: true,
        employeeId: true,
        clientAddress: { select: { city: true } },
        cleaners: { select: { id: true } },
      },
      orderBy: { startTime: "asc" },
      take: MAX_JOBS_PER_RUN,
    });
    const due: ReminderJob[] = jobs
      .map((j) => ({
        jobId: j.id,
        startTime: j.startTime,
        userIds: [...new Set([...j.cleaners.map((c) => c.id), ...(j.employeeId ? [j.employeeId] : [])])],
        notice: reminderNotice(j),
      }))
      .filter((j) => j.userIds.length > 0);
    const r = await sendJobReminders(pushDeps(), due);
    return { jobs: due.length, ...r };
  });

  return NextResponse.json({ ok: true, ...summarise(results) });
}
