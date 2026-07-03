import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { logActivity } from "@/lib/activity-log";
import { db } from "@/db";
import { sendReminder24h } from "@/lib/email";
import { smsReminder } from "@/lib/sms";

// Vercel Cron: runs daily at 13:00 UTC (~9 AM EDT / 8 AM EST — America/Toronto)
// vercel.json: { "crons": [{ "path": "/api/cron/reminders", "schedule": "0 13 * * *" }] }

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization");
  if (!isAuthorizedCron(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find jobs starting tomorrow (midnight–midnight UTC)
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const dayAfter = new Date(tomorrow);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

  const jobs = await db.job.findMany({
    where: {
      startTime: { gte: tomorrow, lt: dayAfter },
      status: { notIn: ["CANCELLED"] },
    },
    include: {
      client: { select: { name: true, email: true, phone: true } },
      cleaners: { select: { name: true } },
    },
  });

  let sent = 0;
  let skipped = 0;

  for (const job of jobs) {
    if (!job.client?.email) { skipped++; continue; }

    // Skip if already sent for this job
    const existing = await db.emailLog.findFirst({
      where: { jobId: job.id, kind: "REMINDER_24H", status: { in: ["SENT", "PENDING", "FAILED"] } },
    });
    if (existing) { skipped++; continue; }

    const log = await db.emailLog.create({
      data: {
        kind: "REMINDER_24H",
        recipient: job.client.email,
        subject: `Reminder: your cleaning is tomorrow`,
        status: "PENDING",
        jobId: job.id,
      },
    });

    await sendReminder24h({
      to: job.client.email,
      clientName: job.client.name,
      jobId: job.id,
      startTime: job.startTime.toISOString(),
      address: job.location ?? "",
      serviceType: job.jobType,
      cleanerNames: job.cleaners.map((c) => c.name),
      logId: log.id,
    });

    // Customer SMS reminder (gated by Twilio config + catalog toggle).
    if (job.client.phone) {
      await smsReminder({
        to: job.client.phone,
        jobNumber: job.jobNumber,
        startTime: job.startTime.toISOString(),
      }).catch((e) => console.error("customer reminder sms", e));
    }

    sent++;
  }

  await logActivity({
    category: "CRON",
    action: "reminders",
    status: "SUCCESS",
    message: `Reminders cron: sent ${sent}, skipped ${skipped}`,
  });
  return NextResponse.json({ ok: true, sent, skipped });
}
