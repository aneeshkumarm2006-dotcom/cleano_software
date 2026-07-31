/**
 * Monthly cron — runs on the 1st of each month at 09:00 server time.
 * Sends every active client their previous-month statement (HTML email
 * + PDF attachment).
 *
 * Idempotent via EmailLog.notificationKey = `monthly_statement:<YYYY-MM>`.
 *
 * Auth: `Bearer ${process.env.CRON_SECRET}` header.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { logActivity } from "@/lib/activity-log";
import { db } from "@/db";
import { sendCustomerMonthlyStatement } from "@/lib/email";
import {
  buildStatementPdfBuffer,
  type StatementBookingRow,
} from "@/lib/statement-pdf";

function lastMonthRange(now: Date) {
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthLabel = start.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return {
    start,
    end,
    monthLabel,
    monthKey,
    periodStart: fmtDay(start),
    periodEnd: fmtDay(new Date(end.getTime() - 1)),
  };
}

async function ensureNotSent(notificationKey: string, recipient: string) {
  const existing = await db.emailLog.findFirst({
    where: {
      notificationKey,
      recipient,
      status: { in: ["SENT", "PENDING", "FAILED"] },
    },
    select: { id: true },
  });
  if (existing) return null;
  return db.emailLog.create({
    data: {
      kind: "OTHER",
      notificationKey,
      recipient,
      subject: notificationKey,
      status: "PENDING",
    },
    select: { id: true },
  });
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization");
  if (!isAuthorizedCron(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const period = lastMonthRange(now);
  const notificationKey = `monthly_statement:${period.monthKey}`;

  const clients = await db.client.findMany({
    where: { isActive: true, email: { not: null } },
    select: { id: true, name: true, email: true },
  });

  let sent = 0;
  let skipped = 0;
  const errors: Array<{ clientId: string; error: string }> = [];

  for (const client of clients) {
    if (!client.email) {
      skipped++;
      continue;
    }
    const log = await ensureNotSent(notificationKey, client.email);
    if (!log) {
      skipped++;
      continue;
    }

    const jobs = await db.job.findMany({
      where: {
        clientId: client.id,
        // Archived jobs stay off client statements (item 1).
        deletedAt: null,
        startTime: { gte: period.start, lt: period.end },
      },
      orderBy: { startTime: "asc" },
      select: {
        jobNumber: true,
        jobDate: true,
        startTime: true,
        jobType: true,
        price: true,
        discountAmount: true,
        paymentReceived: true,
      },
    });

    if (jobs.length === 0) {
      // No activity — skip silently. Keep the log row so re-runs same
      // month don't re-process the client.
      skipped++;
      continue;
    }

    const bookings: StatementBookingRow[] = jobs.map((j) => ({
      jobNumber: j.jobNumber,
      jobDate: (j.jobDate ?? j.startTime).toISOString(),
      serviceType: j.jobType,
      amount: Math.max(0, (j.price ?? 0) - (j.discountAmount ?? 0)),
      paid: j.paymentReceived,
    }));

    const totalBilled = bookings.reduce((s, b) => s + b.amount, 0);
    const totalPaid = bookings
      .filter((b) => b.paid)
      .reduce((s, b) => s + b.amount, 0);
    const totalOutstanding = totalBilled - totalPaid;

    try {
      const pdf = await buildStatementPdfBuffer({
        clientName: client.name,
        monthLabel: period.monthLabel,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        bookings,
        totalBilled,
        totalPaid,
        totalOutstanding,
      });

      await sendCustomerMonthlyStatement({
        to: client.email,
        clientName: client.name,
        monthLabel: period.monthLabel,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        totalBilled,
        totalPaid,
        totalOutstanding,
        bookingsCount: bookings.length,
        pdf,
      });

      await db.emailLog.update({
        where: { id: log.id },
        data: { status: "SENT" },
      });
      sent++;
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ?? "monthly statement failed";
      console.error("monthly statement failed for", client.email, e);
      errors.push({ clientId: client.id, error: msg });
      await db.emailLog
        .update({
          where: { id: log.id },
          data: { status: "FAILED", error: msg },
        })
        .catch(() => {});
    }
  }

  await logActivity({
    category: "CRON",
    action: "monthly",
    status: errors.length > 0 ? "FAILED" : "SUCCESS",
    message: `Monthly statements (${period.monthLabel}): sent ${sent}, skipped ${skipped}, failed ${errors.length}`,
    error: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
  });
  return NextResponse.json({
    ok: true,
    monthLabel: period.monthLabel,
    sent,
    skipped,
    failed: errors.length,
    errors,
  });
}
