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
import { addStoreMonths, formatDate, startOfStoreMonth, storeMonthPeriod } from "@/lib/timezone";
import { ACTIVE_VALUE_SELECT } from "@/lib/metrics";
import { activeSubtotal } from "@/lib/job-money";

// Store-timezone month boundaries. Cron fires on the host (UTC), so
// `new Date(y, m, 1)` was 8 PM on the last day of the previous month in
// Montréal — the statement both started and ended a few hours early, pulling
// one evening's jobs into the wrong month (Q9).
function lastMonthRange(now: Date) {
  const end = startOfStoreMonth(now);
  const start = startOfStoreMonth(addStoreMonths(now, -1));
  const monthLabel = formatDate(start, { month: "long", year: "numeric" });
  const monthKey = storeMonthPeriod(start);
  const fmtDay = (d: Date) =>
    formatDate(d, { month: "short", day: "numeric", year: "numeric" });
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
        // Fix 3: a customer statement lists what each booking was WORTH, so it
        // reads the active subtotal — otherwise the statement disagrees with
        // the invoice and the receipt for the same job.
        ...ACTIVE_VALUE_SELECT,
        jobNumber: true,
        jobDate: true,
        startTime: true,
        jobType: true,
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
      amount: activeSubtotal(j),
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
