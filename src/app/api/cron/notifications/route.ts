/**
 * Unified cron dispatcher for all time-window-based notifications (Yellow batch).
 *
 * Designed to be invoked every 5 minutes (Vercel cron, GitHub Actions, etc.).
 * Each individual notification check uses its own time window — wider windows
 * (e.g., 12h reminder) only fire once per job because we record an EmailLog
 * row keyed on `notificationKey + jobId` for idempotency.
 *
 * Auth: `Bearer ${process.env.CRON_SECRET}` header.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sweepPastScheduledJobs } from "@/lib/job-sweep";
import { logActivity } from "@/lib/activity-log";
import { notifyAdmins } from "@/lib/admin-alerts";
import { db } from "@/lib/org-db";
import { forEachOrganization, summarise } from "@/lib/cron-tenants";
import {
  sendAdminUnassignedDeadline,
  sendAdminNotClockedIn,
  sendAdminCashCheckReminder,
  sendAdminPoorRatingTwiceWeek,
  sendCustomerReminder48h,
  sendCustomerNeverFoundProvider,
  sendCustomerLeaveTip,
  sendProviderJobReminder,
  sendGiftCardToRecipient,
  sendCustomerCardExpiring,
  sendAdminCardExpiring,
} from "@/lib/email";
import { STORE_TZ } from "@/lib/timezone";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface DispatchCounts {
  unassigned_12h: number;
  unassigned_4h: number;
  unassigned_1h: number;
  not_clocked_in: number;
  cash_check_reminder: number;
  poor_rating_twice_week: number;
  reminder_48h: number;
  never_found_provider: number;
  leave_tip: number;
  provider_one_day: number;
  provider_one_hour: number;
  provider_unassigned_pool: number;
  /** Last-minute broadcast offers that lapsed (these genuinely expire). */
  invite_broadcast_expired: number;
  /** One-time "assignment unconfirmed" nudges raised to admins. */
  invite_unconfirmed_alert: number;
  /** Unconfirmed invites whose cleaner had since been taken off the job. */
  invite_unconfirmed_skipped: number;
  skipped: number;
}

/** Returns true if a fresh EmailLog row should be created (i.e. not sent yet). */
async function ensureNotSent(
  notificationKey: string,
  jobId: string | null,
  recipient: string,
): Promise<{ id: string } | null> {
  const existing = await db.emailLog.findFirst({
    where: {
      notificationKey,
      jobId: jobId ?? undefined,
      recipient,
      // Include FAILED: a window-keyed notification is attempted once per
      // window. Without this, a failing send (e.g. a bad EMAIL_FROM) retries
      // every cron run forever and floods the logs.
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
      jobId: jobId ?? undefined,
    },
    select: { id: true },
  });
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
    const counts: DispatchCounts = {
      unassigned_12h: 0,
      unassigned_4h: 0,
      unassigned_1h: 0,
      not_clocked_in: 0,
      cash_check_reminder: 0,
      poor_rating_twice_week: 0,
      reminder_48h: 0,
      never_found_provider: 0,
      leave_tip: 0,
      provider_one_day: 0,
      provider_one_hour: 0,
      provider_unassigned_pool: 0,
      invite_broadcast_expired: 0,
      invite_unconfirmed_alert: 0,
      invite_unconfirmed_skipped: 0,
      skipped: 0,
    };

    // ─── Auto-complete past jobs (spec item 8) ────────────────────────
    // Yesterday-or-earlier CREATED/SCHEDULED/IN_PROGRESS jobs become
    // COMPLETED (or PAID when payment was already received). Runs before the
    // notification windows so e.g. "not clocked in" doesn't fire for jobs the
    // sweep just closed.
    const swept = await sweepPastScheduledJobs(now).catch((e) => {
      console.error("job sweep failed", e);
      return { completed: 0, paid: 0 };
    });

    // ─── Unassigned booking deadlines (admin) ─────────────────────────
    // Three windows: ~12h, ~4h, ~1h out. 10-minute window each to overlap
    // safely with a 5-min cron cadence.
    for (const w of [
      {
        key: "12h" as const,
        lo: 12 * HOUR - 5 * MINUTE,
        hi: 12 * HOUR + 5 * MINUTE,
        catalog: "admin.unassigned.starts_12h",
      },
      {
        key: "4h" as const,
        lo: 4 * HOUR - 5 * MINUTE,
        hi: 4 * HOUR + 5 * MINUTE,
        catalog: "admin.unassigned.starts_4h",
      },
      {
        key: "1h" as const,
        lo: 1 * HOUR - 5 * MINUTE,
        hi: 1 * HOUR + 5 * MINUTE,
        catalog: "admin.unassigned.starts_1h",
      },
    ]) {
      const windowStart = new Date(now.getTime() + w.lo);
      const windowEnd = new Date(now.getTime() + w.hi);
      const jobs = await db.job.findMany({
        where: {
          // Archived jobs raise no alerts and send no mail (item 1).
          deletedAt: null,
          startTime: { gte: windowStart, lt: windowEnd },
          status: { notIn: ["CANCELLED", "COMPLETED", "PAID"] },
          cleaners: { none: {} },
        },
        include: {
          // Use a single admin email recipient marker for idempotency.
          // We'll use "admins" as the recipient key.
        },
      });
      for (const job of jobs) {
        const log = await ensureNotSent(w.catalog, job.id, "admins");
        if (!log) {
          counts.skipped++;
          continue;
        }
        await sendAdminUnassignedDeadline({
          window: w.key,
          jobId: job.id,
          jobNumber: job.jobNumber,
          clientName: job.clientName,
          startTime: job.startTime.toISOString(),
          logId: log.id,
        }).catch((e) => console.error("unassigned deadline", w.key, e));
        counts[
          w.key === "12h"
            ? "unassigned_12h"
            : w.key === "4h"
              ? "unassigned_4h"
              : "unassigned_1h"
        ]++;
      }
    }

    // ─── Booking not clocked in (admin) ───────────────────────────────
    // Fires once per job between 15-60 min after scheduled start, when no clock-in.
    {
      const lo = new Date(now.getTime() - 60 * MINUTE);
      const hi = new Date(now.getTime() - 15 * MINUTE);
      const jobs = await db.job.findMany({
        where: {
          deletedAt: null,
          startTime: { gte: lo, lt: hi },
          clockInTime: null,
          status: { in: ["CREATED", "SCHEDULED"] },
        },
        include: { cleaners: { select: { name: true } } },
      });
      for (const job of jobs) {
        const log = await ensureNotSent(
          "admin.clock.not_clocked_in",
          job.id,
          "admins",
        );
        if (!log) {
          counts.skipped++;
          continue;
        }
        await sendAdminNotClockedIn({
          jobId: job.id,
          jobNumber: job.jobNumber,
          clientName: job.clientName,
          cleanerNames: job.cleaners.map((c) => c.name),
          startTime: job.startTime.toISOString(),
          logId: log.id,
        }).catch((e) => console.error("not clocked in", e));
        counts.not_clocked_in++;
      }
    }

    // ─── Cash/check upcoming booking reminder (admin) ─────────────────
    // Fires once per cash/check job 24h before start.
    {
      const lo = new Date(now.getTime() + 24 * HOUR - 30 * MINUTE);
      const hi = new Date(now.getTime() + 24 * HOUR + 30 * MINUTE);
      const jobs = await db.job.findMany({
        where: {
          deletedAt: null,
          startTime: { gte: lo, lt: hi },
          paymentType: { in: ["CASH", "CHEQUE"] },
          status: { notIn: ["CANCELLED", "COMPLETED", "PAID"] },
        },
      });
      for (const job of jobs) {
        const log = await ensureNotSent(
          "admin.reminders.cash_check",
          job.id,
          "admins",
        );
        if (!log) {
          counts.skipped++;
          continue;
        }
        await sendAdminCashCheckReminder({
          jobId: job.id,
          jobNumber: job.jobNumber,
          clientName: job.clientName,
          startTime: job.startTime.toISOString(),
          paymentType: job.paymentType ?? "cash/cheque",
          logId: log.id,
        }).catch((e) => console.error("cash check reminder", e));
        counts.cash_check_reminder++;
      }
    }

    // ─── Customer 48h reminder ────────────────────────────────────────
    {
      const lo = new Date(now.getTime() + 48 * HOUR - 30 * MINUTE);
      const hi = new Date(now.getTime() + 48 * HOUR + 30 * MINUTE);
      const jobs = await db.job.findMany({
        where: {
          deletedAt: null,
          startTime: { gte: lo, lt: hi },
          status: { notIn: ["CANCELLED"] },
        },
        include: {
          client: { select: { name: true, email: true } },
          cleaners: { select: { name: true } },
        },
      });
      for (const job of jobs) {
        if (!job.client?.email) {
          counts.skipped++;
          continue;
        }
        const log = await ensureNotSent(
          "cust.reminders.booking_reminder_2",
          job.id,
          job.client.email,
        );
        if (!log) {
          counts.skipped++;
          continue;
        }
        await sendCustomerReminder48h({
          to: job.client.email,
          recipientName: job.client.name,
          jobId: job.id,
          jobNumber: job.jobNumber,
          clientName: job.client.name,
          startTime: job.startTime.toISOString(),
          address: job.location ?? "",
          cleanerNames: job.cleaners.map((c) => c.name),
          logId: log.id,
        }).catch((e) => console.error("48h reminder", e));
        counts.reminder_48h++;
      }
    }

    // ─── Never found a provider (customer) ────────────────────────────
    // Fires when a job is unassigned ≤30 minutes before its start time.
    {
      const lo = new Date(now.getTime() - 5 * MINUTE);
      const hi = new Date(now.getTime() + 30 * MINUTE);
      const jobs = await db.job.findMany({
        where: {
          deletedAt: null,
          startTime: { gte: lo, lt: hi },
          status: { notIn: ["CANCELLED", "COMPLETED", "PAID"] },
          cleaners: { none: {} },
        },
        include: { client: { select: { name: true, email: true } } },
      });
      for (const job of jobs) {
        if (!job.client?.email) {
          counts.skipped++;
          continue;
        }
        const log = await ensureNotSent(
          "cust.cancel.never_found_provider",
          job.id,
          job.client.email,
        );
        if (!log) {
          counts.skipped++;
          continue;
        }
        await sendCustomerNeverFoundProvider({
          to: job.client.email,
          clientName: job.client.name,
          jobId: job.id,
          jobNumber: job.jobNumber,
          startTime: job.startTime.toISOString(),
          logId: log.id,
        }).catch((e) => console.error("never found provider", e));
        counts.never_found_provider++;
      }
    }

    // ─── Leave-tip follow-up (customer) ───────────────────────────────
    // Fires 24h after job completion if no tip yet.
    //
    // Item 6 (round 3) note: `clockOutTime` is now DERIVED from work sessions, so
    // a cleaner who clocks back in and out again moves it — which would drop the
    // job into this 24h window a second time. `ensureNotSent` already keys on
    // (notificationKey, jobId, recipient), so the second pass finds the existing
    // EmailLog row and skips: one tip nudge per job, per Decision 4. No extra
    // dedupe was added; the existing one is the right shape and was verified to
    // cover the resume case rather than assumed to.
    {
      const lo = new Date(now.getTime() - 24 * HOUR - 30 * MINUTE);
      const hi = new Date(now.getTime() - 24 * HOUR + 30 * MINUTE);
      const jobs = await db.job.findMany({
        where: {
          deletedAt: null,
          clockOutTime: { gte: lo, lt: hi },
          status: "COMPLETED",
          OR: [{ totalTip: null }, { totalTip: 0 }],
        },
        include: {
          client: { select: { name: true, email: true } },
          cleaners: { select: { name: true } },
        },
      });
      for (const job of jobs) {
        if (!job.client?.email) {
          counts.skipped++;
          continue;
        }
        const log = await ensureNotSent(
          "cust.completed.leave_tip",
          job.id,
          job.client.email,
        );
        if (!log) {
          counts.skipped++;
          continue;
        }
        await sendCustomerLeaveTip({
          to: job.client.email,
          clientName: job.client.name,
          jobId: job.id,
          jobNumber: job.jobNumber,
          cleanerNames: job.cleaners.map((c) => c.name),
          logId: log.id,
        }).catch((e) => console.error("leave tip", e));
        counts.leave_tip++;
      }
    }

    // ─── Provider 1-day reminder ──────────────────────────────────────
    {
      const lo = new Date(now.getTime() + 24 * HOUR - 30 * MINUTE);
      const hi = new Date(now.getTime() + 24 * HOUR + 30 * MINUTE);
      const jobs = await db.job.findMany({
        where: {
          deletedAt: null,
          startTime: { gte: lo, lt: hi },
          status: { notIn: ["CANCELLED"] },
          cleaners: { some: {} },
        },
        include: {
          cleaners: { select: { id: true, name: true, email: true } },
        },
      });
      for (const job of jobs) {
        for (const c of job.cleaners) {
          if (!c.email) {
            counts.skipped++;
            continue;
          }
          const log = await ensureNotSent(
            "prov.reminders.one_day",
            job.id,
            c.email,
          );
          if (!log) {
            counts.skipped++;
            continue;
          }
          await sendProviderJobReminder({
            window: "1d",
            to: c.email,
            providerName: c.name,
            jobId: job.id,
            jobNumber: job.jobNumber,
            clientName: job.clientName,
            startTime: job.startTime.toISOString(),
            address: job.location ?? "",
            logId: log.id,
          }).catch((e) => console.error("provider 1d", e));
          counts.provider_one_day++;
        }
      }
    }

    // ─── Provider 1-hour reminder ─────────────────────────────────────
    {
      const lo = new Date(now.getTime() + 60 * MINUTE - 10 * MINUTE);
      const hi = new Date(now.getTime() + 60 * MINUTE + 10 * MINUTE);
      const jobs = await db.job.findMany({
        where: {
          deletedAt: null,
          startTime: { gte: lo, lt: hi },
          status: { notIn: ["CANCELLED"] },
          cleaners: { some: {} },
        },
        include: {
          cleaners: { select: { id: true, name: true, email: true } },
        },
      });
      for (const job of jobs) {
        for (const c of job.cleaners) {
          if (!c.email) {
            counts.skipped++;
            continue;
          }
          const log = await ensureNotSent(
            "prov.reminders.one_hour",
            job.id,
            c.email,
          );
          if (!log) {
            counts.skipped++;
            continue;
          }
          await sendProviderJobReminder({
            window: "1h",
            to: c.email,
            providerName: c.name,
            jobId: job.id,
            jobNumber: job.jobNumber,
            clientName: job.clientName,
            startTime: job.startTime.toISOString(),
            address: job.location ?? "",
            logId: log.id,
          }).catch((e) => console.error("provider 1h", e));
          counts.provider_one_hour++;
        }
      }
    }

    // ─── Provider "unassigned pool reminder" ──────────────────────────
    // Daily nudge to all active cleaners when at least one open booking is
    // in the unassigned folder within the next 7 days. One row per cleaner per day.
    {
      const todayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const open = await db.job.count({
        where: {
          deletedAt: null,
          startTime: { gte: now, lt: new Date(now.getTime() + 7 * DAY) },
          status: { notIn: ["CANCELLED", "COMPLETED", "PAID"] },
          cleaners: { none: {} },
        },
      });
      if (open > 0) {
        const cleaners = await db.user.findMany({
          where: { role: "EMPLOYEE" },
          select: { id: true, name: true, email: true },
        });
        for (const c of cleaners) {
          if (!c.email) {
            counts.skipped++;
            continue;
          }
          const log = await ensureNotSent(
            `prov.reminders.unassigned:${todayKey}`,
            null,
            c.email,
          );
          if (!log) {
            counts.skipped++;
            continue;
          }
          await sendProviderJobReminder({
            window: "unassigned_pool",
            to: c.email,
            providerName: c.name,
            jobId: "",
            jobNumber: 0,
            clientName: "",
            startTime: now.toISOString(),
            address: "",
            logId: log.id,
          }).catch((e) => console.error("provider unassigned pool", e));
          counts.provider_unassigned_pool++;
        }
      }
    }

    // ─── Admin: poor rating ≥2 in past 7 days (daily) ─────────────────
    // Fires once per cleaner per 7-day window when threshold crossed.
    {
      const sevenDaysAgo = new Date(now.getTime() - 7 * DAY);
      const poorRatings = await db.employeeRating.findMany({
        // An excluded rating never triggers a low-rating alert (item 5).
        where: {
          rating: { lte: 3 },
          excludedAt: null,
          createdAt: { gte: sevenDaysAgo },
        },
        select: { employeeId: true },
      });
      const byCleaner = new Map<string, number>();
      for (const r of poorRatings) {
        byCleaner.set(r.employeeId, (byCleaner.get(r.employeeId) ?? 0) + 1);
      }
      // Idempotent per 7-day rolling window using week-of-year.
      const weekKey = `${now.getUTCFullYear()}W${Math.floor(now.getUTCDate() / 7)}`;
      for (const [employeeId, count] of byCleaner.entries()) {
        if (count < 2) continue;
        const cleaner = await db.user.findUnique({
          where: { id: employeeId },
          select: { name: true },
        });
        if (!cleaner) continue;
        const log = await ensureNotSent(
          `admin.rating.poor_twice_week:${employeeId}:${weekKey}`,
          null,
          "admins",
        );
        if (!log) {
          counts.skipped++;
          continue;
        }
        await sendAdminPoorRatingTwiceWeek({
          cleanerName: cleaner.name,
          count,
          logId: log.id,
        }).catch((e) => console.error("poor x2 week", e));
        counts.poor_rating_twice_week++;
      }
    }

    // ── Sweep lapsed LAST-MINUTE broadcast invites ───────────────────
    // These are a race for an OPEN job after somebody cancelled: first to accept
    // gets it, and a lapsed one really is dead. Hard expiry is correct here and
    // is unchanged (awerfixes.pdf item 4 deliberately carves these out — the
    // target is the hold on an ASSIGNED job, and a broadcast job is never held).
    const expiredInvites = await db.jobAssignmentInvite.findMany({
      where: {
        decision: "PENDING",
        isLastMinute: true,
        expiresAt: { lt: now },
      },
      select: { id: true, jobId: true, cleanerId: true },
      take: 200,
    });
    for (const inv of expiredInvites) {
      try {
        await db.$transaction(async (tx) => {
          const __t0 = await tx.jobAssignmentInvite.update({
              where: { id: inv.id },
              data: { decision: "EXPIRED", respondedAt: now },
            });
          const __t1 = await tx.jobLog.create({
              data: {
                jobId: inv.jobId,
                userId: inv.cleanerId,
                action: "NOTE_ADDED",
                description:
                  "Last-minute claim offer expired — no response within the configured window.",
              },
            });
          return [__t0, __t1];
        });
        counts.invite_broadcast_expired++;
      } catch (e) {
        console.error("expired invite sweep failed", inv.id, e);
      }
    }

    // ── Nudge admins about UNCONFIRMED DIRECT assignments ────────────
    // A direct assignment does NOT lapse. The cleaner is already on the job and
    // stays there; only an admin or their own decline can change that. So this
    // pass writes NO decision and NO respondedAt — stamping "EXPIRED" on a row
    // that cannot expire is exactly what produced the 10-minute pending-hold
    // experience the client reported.
    //
    // What survives is the useful half: a one-time WARNING so an admin knows the
    // cleaner hasn't acknowledged the job yet. `unconfirmedAlertAt` is the dedupe
    // (notifyAdmins has none of its own), and createAssignmentInvites clears it
    // when a cleaner is re-invited.
    const unconfirmed = await db.jobAssignmentInvite.findMany({
      where: {
        decision: "PENDING",
        isLastMinute: false,
        expiresAt: { lt: now },
        unconfirmedAlertAt: null,
        job: { deletedAt: null },
      },
      select: {
        id: true,
        jobId: true,
        cleanerId: true,
        job: {
          select: {
            jobNumber: true,
            clientName: true,
            employeeId: true,
            cleaners: { select: { id: true } },
          },
        },
        cleaner: { select: { name: true } },
      },
      take: 200,
    });
    for (const inv of unconfirmed) {
      try {
        // An admin may have taken this cleaner off the job since the invite went
        // out; nothing cancels the invite when that happens. Alerting "they are
        // still assigned — confirm or reassign" about somebody who is NOT on the
        // job is worse than silence, so mark it handled and move on.
        const stillOnJob =
          inv.job.employeeId === inv.cleanerId ||
          inv.job.cleaners.some((c) => c.id === inv.cleanerId);

        await db.$transaction(async (tx) => {
          await tx.jobAssignmentInvite.update({
            where: { id: inv.id },
            data: { unconfirmedAlertAt: now },
          });
          // Only leave a note on the job when the cleaner is actually still on
          // it; see the comment above.
          if (stillOnJob) {
            await tx.jobLog.create({
              data: {
                jobId: inv.jobId,
                userId: inv.cleanerId,
                action: "NOTE_ADDED" as const,
                description:
                  "Assignment not yet confirmed — no response within the configured window. The cleaner remains assigned; confirm manually or reassign.",
              },
            });
          }
        });

        if (!stillOnJob) {
          counts.invite_unconfirmed_skipped++;
          continue;
        }

        // Title names the JOB, body names the CLEANER — matching the house style
        // of the other job alerts (cf. "Trainee left unpaired — Job #N" in
        // lib/job-assignments.ts). It used to title the alert with the CLIENT's
        // name while the body named the cleaner, so a row read "Rami Chaaban /
        // Divanshu hasn't responded" and looked like a data bug (item 26). The
        // client's name stays in the body, where it reads as context rather than
        // as the subject.
        await notifyAdmins({
          type: "GENERAL",
          severity: "WARNING",
          title: `Assignment unconfirmed — Job #${inv.job.jobNumber}`,
          message: `${inv.cleaner?.name ?? "A cleaner"} hasn't confirmed Job #${inv.job.jobNumber} for ${inv.job.clientName} yet. They are still assigned — chase them or reassign.`,
          relatedId: inv.jobId,
          relatedType: "Job",
        });
        counts.invite_unconfirmed_alert++;
      } catch (e) {
        console.error("unconfirmed assignment nudge failed", inv.id, e);
      }
    }

    // ── Scheduled gift card deliveries ───────────────────────────────
    // Gift cards with a scheduled date now in the past (or exactly now)
    // that haven't been delivered yet.
    const dueGiftCards = await db.giftCard.findMany({
      where: {
        status: "ACTIVE",
        deliveredAt: null,
        scheduledDeliveryDate: { lte: now },
      },
      take: 50,
    });
    let giftCardsDelivered = 0;
    for (const card of dueGiftCards) {
      try {
        await sendGiftCardToRecipient({
          to: card.recipientEmail,
          recipientName: card.recipientName,
          purchaserName: card.purchaserName,
          amount: card.amount,
          code: card.code,
          personalMessage: card.personalMessage,
          coverKey: card.coverKey,
        });
        await db.giftCard.update({
          where: { id: card.id },
          data: { deliveredAt: new Date() },
        });
        giftCardsDelivered++;
      } catch (e) {
        console.error("scheduled gift card delivery failed", card.id, e);
      }
    }

    // ---- Saved card expiring before an upcoming booking ---------------------
    // Warns BEFORE the charge fails rather than after. Only the client's earliest
    // upcoming booking is considered — one warning per client, not one per visit.
    let cardExpiryNotices = 0;
    try {
      const upcomingJobs = await db.job.findMany({
        where: {
          deletedAt: null,
          status: { notIn: ["CANCELLED"] },
          startTime: { gte: now },
          clientId: { not: null },
        },
        orderBy: { startTime: "asc" },
        select: {
          id: true,
          jobNumber: true,
          startTime: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              defaultPaymentMethodId: true,
            },
          },
        },
      });

      const seenClients = new Set<string>();

      for (const job of upcomingJobs) {
        const client = job.client;
        if (!client?.defaultPaymentMethodId || !job.startTime) continue;
        if (seenClients.has(client.id)) continue;
        seenClients.add(client.id);

        const card = await db.clientPaymentMethod.findFirst({
          where: {
            clientId: client.id,
            stripePaymentMethodId: client.defaultPaymentMethodId,
          },
          select: { brand: true, last4: true, expMonth: true, expYear: true },
        });
        if (!card?.expMonth || !card.expYear) continue;

        // A card is valid through the last day of its expiry month, so it dies at
        // the start of the following month.
        const cardExpiresAt = new Date(card.expYear, card.expMonth, 1);
        if (cardExpiresAt > job.startTime) continue; // still valid on the day

        const expLabel = `${String(card.expMonth).padStart(2, "0")}/${card.expYear}`;
        const jobDateLabel = job.startTime.toLocaleDateString("en-CA", {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: STORE_TZ,
        });

        if (client.email) {
          const log = await ensureNotSent(
            "cust.card.expiring",
            job.id,
            client.email,
          );
          if (log) {
            try {
              await sendCustomerCardExpiring({
                to: client.email,
                clientName: client.name,
                brand: card.brand,
                last4: card.last4,
                expLabel,
                jobNumber: job.jobNumber,
                jobDateLabel,
              });
              await db.emailLog.update({
                where: { id: log.id },
                data: { status: "SENT" },
              });
              cardExpiryNotices++;
            } catch (e) {
              console.error("card expiring (customer)", client.id, e);
              await db.emailLog
                .update({ where: { id: log.id }, data: { status: "FAILED" } })
                .catch(() => {});
            }
          }
        }

        const adminLog = await ensureNotSent(
          "admin.card.expiring",
          job.id,
          "admins",
        );
        if (adminLog) {
          try {
            await sendAdminCardExpiring({
              clientId: client.id,
              clientName: client.name,
              brand: card.brand,
              last4: card.last4,
              expLabel,
              jobId: job.id,
              jobNumber: job.jobNumber,
              jobDateLabel,
            });
            await db.emailLog.update({
              where: { id: adminLog.id },
              data: { status: "SENT" },
            });
          } catch (e) {
            console.error("card expiring (admin)", client.id, e);
            await db.emailLog
              .update({
                where: { id: adminLog.id },
                data: { status: "FAILED" },
              })
              .catch(() => {});
          }
        }
      }
    } catch (e) {
      // Never let this sweep take down the rest of the cron.
      console.error("card expiry sweep failed", e);
    }

    await logActivity({
      category: "CRON",
      action: "notifications",
      status: "SUCCESS",
      message: `Notifications cron ran (${expiredInvites.length} expired invites, ${giftCardsDelivered} gift cards delivered, ${cardExpiryNotices} card-expiry notices)`,
    });
    return {
      at: now.toISOString(),
      counts,
      expiredInvites: expiredInvites.length,
      giftCardsDelivered,
      cardExpiryNotices,
      sweptCompleted: swept.completed,
      sweptPaid: swept.paid,
    };
  });

  return NextResponse.json({ ok: true, ...summarise(results) });
}
