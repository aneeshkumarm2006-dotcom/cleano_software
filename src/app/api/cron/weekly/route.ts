/**
 * Weekly cron — runs every Monday morning at 09:00 server time.
 *
 *  - Provider performance email to each active cleaner (hours, jobs, rating, tips)
 *  - Rag Wash dashboard email to admin (rags credited, payouts, flagged jobs)
 *
 * Idempotent: each provider's weekly email is logged with a unique
 * `notificationKey` of `weekly_perf:<YYYY-MM-DD>` so re-runs in the same
 * week don't double-send.
 *
 * Auth: `Bearer ${process.env.CRON_SECRET}` header.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { logActivity } from "@/lib/activity-log";
import { previousPayPeriodRange } from "@/lib/pay-period";
import { generatePayPeriodForWeek } from "@/lib/pay-period.server";
import { db } from "@/lib/org-db";
import { forEachOrganization, summarise } from "@/lib/cron-tenants";
import {
  sendProviderWeeklyPerformance,
  sendAdminWeeklyRagWashDashboard,
} from "@/lib/email";
import {
  addStoreDays,
  formatDate,
  startOfStoreDay,
  storeDateKey,
} from "@/lib/timezone";

// Store-timezone day boundaries — setHours(0) on the host gave UTC midnight,
// which is 8 PM the previous evening in Montréal, so the digest window was
// shifted by 4-5 hours in both directions (Q9).
function weekRange(now: Date) {
  const end = startOfStoreDay(now);
  const start = addStoreDays(end, -7);
  const fmtDay = (d: Date) => formatDate(d, { month: "short", day: "numeric" });
  return { start, end, label: `${fmtDay(start)} – ${fmtDay(end)}` };
}

// Dedupe key for "already sent this week" — must be the store civil day, or a
// week starting at 04:00Z would key off the wrong date near DST changes.
function isoDay(d: Date) {
  return storeDateKey(d);
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

async function runProviderPerformance(
  weekStart: Date,
  weekEnd: Date,
  label: string,
) {
  const notificationKey = `weekly_perf:${isoDay(weekStart)}`;

  const providers = await db.user.findMany({
    where: { role: { in: ["EMPLOYEE", "FIELD_LEAD"] } },
    select: { id: true, name: true, email: true },
  });

  let sent = 0;
  let skipped = 0;

  for (const provider of providers) {
    if (!provider.email) {
      skipped++;
      continue;
    }
    const log = await ensureNotSent(notificationKey, provider.email);
    if (!log) {
      skipped++;
      continue;
    }

    // Jobs completed in window. Tips are stored on the Job as a single
    // `tipAmount` and split equally across assigned cleaners (matches the
    // multi-cleaner "split equally into wallets" policy).
    const completedJobs = await db.job.findMany({
      where: {
        status: "COMPLETED",
        // Archived jobs are out of weekly provider stats (item 1).
        deletedAt: null,
        clockOutTime: { gte: weekStart, lt: weekEnd },
        cleaners: { some: { id: provider.id } },
      },
      select: {
        id: true,
        clockInTime: true,
        clockOutTime: true,
        tipAmount: true,
        cleaners: { select: { id: true } },
      },
    });

    const jobsCompleted = completedJobs.length;
    const hours = completedJobs.reduce((sum, j) => {
      if (!j.clockInTime || !j.clockOutTime) return sum;
      return (
        sum + (j.clockOutTime.getTime() - j.clockInTime.getTime()) / 3_600_000
      );
    }, 0);
    const tipsTotal = completedJobs.reduce((sum, j) => {
      const headcount = Math.max(1, j.cleaners.length);
      return sum + (j.tipAmount ?? 0) / headcount;
    }, 0);

    const ratingAgg = await db.employeeRating.aggregate({
      where: {
        employeeId: provider.id,
        excludedAt: null,
        createdAt: { gte: weekStart, lt: weekEnd },
      },
      _avg: { rating: true },
      _count: { rating: true },
    });
    const avgRating =
      ratingAgg._count.rating > 0 ? ratingAgg._avg.rating : null;

    // Skip the email if the cleaner had zero activity this week. The
    // PENDING row stays so re-runs in the same week don't re-process them.
    if (jobsCompleted === 0 && hours === 0 && !avgRating && tipsTotal === 0) {
      skipped++;
      continue;
    }

    try {
      await sendProviderWeeklyPerformance({
        to: provider.email,
        providerName: provider.name,
        weekLabel: label,
        hours,
        jobsCompleted,
        avgRating,
        tipsTotal,
      });
      await db.emailLog.update({
        where: { id: log.id },
        data: { status: "SENT" },
      });
      sent++;
    } catch (e) {
      console.error("weekly perf email failed", provider.email, e);
    }
  }

  return { sent, skipped, total: providers.length };
}

async function runRagWashDashboard(
  weekStart: Date,
  weekEnd: Date,
  label: string,
) {
  const notificationKey = `weekly_ragwash:${isoDay(weekStart)}`;

  // We log per "ADMIN" recipient bucket. fetchAdmins inside the helper sends
  // to each individual admin; the dedup is on the dashboard's identity.
  const log = await ensureNotSent(notificationKey, "ADMIN_DASHBOARD");
  if (!log) return { sent: false };

  // Jobs completed this week → sum cappedRags/cappedPads credits
  const jobs = await db.job.findMany({
    where: {
      deletedAt: null,
      clockOutTime: { gte: weekStart, lt: weekEnd },
      washCreditsAwarded: true,
    },
    select: {
      washCappedRags: true,
      washCappedPads: true,
    },
  });

  const ragsCredited = jobs.reduce((s, j) => s + (j.washCappedRags ?? 0), 0);
  const padsCredited = jobs.reduce((s, j) => s + (j.washCappedPads ?? 0), 0);

  // Payouts this week
  const payouts = await db.washPayout.findMany({
    where: { createdAt: { gte: weekStart, lt: weekEnd } },
    select: { amount: true },
  });
  const payoutsCount = payouts.length;
  const payoutsTotal = payouts.reduce((s, p) => s + (p.amount ?? 0), 0);

  // Jobs flagged for review. We treat anything where the projected count
  // exceeded the typical category envelope as flagged (since the hard cap
  // was removed, the projection now flows straight through to credits and
  // we want to surface oversize ones). The numbers below mirror the loosest
  // per-category range in `src/lib/wash/index.ts` (3+BR / MOVE_IN).
  const FLAG_RAGS = 35;
  const FLAG_PADS = 4;
  const flaggedJobsCount = await db.job.count({
    where: {
      deletedAt: null,
      clockOutTime: { gte: weekStart, lt: weekEnd },
      OR: [
        { washCappedRags: { gt: FLAG_RAGS } },
        { washCappedPads: { gt: FLAG_PADS } },
      ],
    },
  });

  try {
    await sendAdminWeeklyRagWashDashboard({
      weekLabel: label,
      ragsCredited,
      padsCredited,
      payoutsCount,
      payoutsTotal,
      flaggedJobsCount,
    });
    await db.emailLog.update({
      where: { id: log.id },
      data: { status: "SENT" },
    });
    return {
      sent: true,
      ragsCredited,
      padsCredited,
      payoutsCount,
      flaggedJobsCount,
    };
  } catch (e) {
    console.error("weekly ragwash dashboard failed", e);
    return { sent: false };
  }
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization");
  if (!isAuthorizedCron(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Once per cleaning company. Inside here `db` resolves to that company,
  // so every helper below -- including the ones defined at module scope --
  // is scoped to it without being handed a client.
  const results = await forEachOrganization(async () => {
    const now = new Date();
    const { start, end, label } = weekRange(now);

    const [perf, dashboard] = await Promise.all([
      runProviderPerformance(start, end, label),
      runRagWashDashboard(start, end, label),
    ]);

    // Auto-advance payroll: cut the DRAFT pay period for the week that just
    // closed (Mon–Sun). Idempotent — an existing non-cancelled period for that
    // week is left alone, so a cron re-run never double-pays a job.
    let payroll: { created: boolean; label?: string; note?: string };
    try {
      const lastWeek = previousPayPeriodRange(now);
      const res = await generatePayPeriodForWeek(
        lastWeek,
        "Auto-created by the Monday payroll cron",
      );
      payroll = res.success
        ? { created: true, label: res.periodLabel }
        : { created: false, note: res.error };
    } catch (e) {
      console.error("weekly cron: pay period", e);
      payroll = { created: false, note: "Failed to create pay period" };
    }

    await logActivity({
      category: "CRON",
      action: "weekly",
      status: "SUCCESS",
      message: `Weekly cron ran for ${label}${
        payroll.created ? ` · pay period created (${payroll.label})` : ""
      }`,
    });
    return { weekLabel: label, perf, dashboard, payroll };
  });

  return NextResponse.json({ ok: true, ...summarise(results) });
}
