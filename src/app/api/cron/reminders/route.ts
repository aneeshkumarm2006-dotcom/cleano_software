import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { logActivity } from "@/lib/activity-log";
import { db } from "@/lib/org-db";
import { forEachOrganization, summarise } from "@/lib/cron-tenants";
import { runLeadFollowUps } from "@/lib/ai-assistant/follow-up";
import { sendReminder24h } from "@/lib/email";
import { smsReminder } from "@/lib/sms";

// Vercel Cron: runs daily at 13:00 UTC (~9 AM EDT / 8 AM EST — America/Toronto)
// vercel.json: { "crons": [{ "path": "/api/cron/reminders", "schedule": "0 13 * * *" }] }

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization");
  if (!isAuthorizedCron(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Once per cleaning company. Inside here `db` resolves to that company, so
  // the body is unchanged and cannot see anyone else's bookings.
  const results = await forEachOrganization(async () => {
    // Find jobs starting tomorrow (midnight–midnight UTC)
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

    const jobs = await db.job.findMany({
      where: {
        // Archived bookings send no reminders (new fix list item 1).
        deletedAt: null,
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
      // Per-booking notification control: client sends disabled for this job.
      if (!job.notifyClient) {
        skipped++;
        continue;
      }
      if (!job.client?.email) {
        skipped++;
        continue;
      }

      // Skip if already sent for this job
      const existing = await db.emailLog.findFirst({
        where: {
          jobId: job.id,
          kind: "REMINDER_24H",
          status: { in: ["SENT", "PENDING", "FAILED"] },
        },
      });
      if (existing) {
        skipped++;
        continue;
      }

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

    // ── AI assistant: one-time follow-up for quiet leads ──────────────
    // Per-workspace opt-in (Settings → AI Assistant, "follow up after N
    // days"); a workspace with it off contributes zero work here. Never
    // throws — a follow-up failure must not cost anyone their reminders.
    const followUps = await runLeadFollowUps().catch((e) => {
      console.error("lead follow-ups failed", e);
      return { eligible: 0, sent: 0, completedSequence: 0, retiredAsClient: 0, skippedNoAddress: 0, failed: 0 };
    });

    await logActivity({
      category: "CRON",
      action: "reminders",
      status: "SUCCESS",
      message: `Reminders cron: sent ${sent}, skipped ${skipped}; lead follow-ups sent ${followUps.sent}/${followUps.eligible}`,
    });
    return { sent, skipped, followUps };
  });

  return NextResponse.json({ ok: true, ...summarise(results) });
}
