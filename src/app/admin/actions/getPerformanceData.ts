"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { multiplierForRating } from "@/lib/pay-multiplier";
import { getRatingMultiplierMap } from "@/lib/pay-multiplier-config";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { STANDARD_RATINGS_REQUIRED } from "@/lib/pay-tiers";
import type {
  PerformanceData,
  RecentRating,
  TrendPoint,
} from "./getPerformanceData.types";

// Trend windows only. Ratings no longer EXPIRE: pay uses the all-time average
// (Decision 2, 2026-08-06), so a 30-day cut is recent form, nothing more.
const TREND_RECENT_DAYS = 30;

interface GetInput {
  employeeId?: string;
}

export async function getPerformanceData(
  input: GetInput = {}
): Promise<
  | { success: true; data: PerformanceData }
  | { success: false; error: string }
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const targetEmployeeId = input.employeeId || session.user.id;

    if (!isAdmin && targetEmployeeId !== session.user.id) {
      return { success: false, error: "Not authorized" };
    }

    const employee = await db.user.findUnique({
      where: { id: targetEmployeeId },
      select: { id: true },
    });
    if (!employee) {
      return { success: false, error: "Employee not found" };
    }

    // ONE window for anything that makes a pay claim (Decision 2): the ALL-TIME
    // `excludedAt: null` average, read through the SAME loader payroll uses.
    // Sourcing it here rather than from the User.payMultiplier cache means this
    // screen can never show a multiplier payday disagrees with, and the cache
    // being briefly stale between recalculations stops mattering for display.
    const rateInputs = await getCleanerRateInputs([targetEmployeeId]);
    const me = rateInputs.get(targetEmployeeId);
    const ratingAllTime = me?.avgRating ?? null;
    const ratingCountAllTime = me?.ratingCount ?? 0;
    const currentMultiplier = me?.multiplier ?? 1;
    const multiplierLocked = ratingCountAllTime < STANDARD_RATINGS_REQUIRED;

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - TREND_RECENT_DAYS);
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const ratings90 = await db.employeeRating.findMany({
      where: {
        employeeId: targetEmployeeId,
        excludedAt: null,
        createdAt: { gte: ninetyDaysAgo },
      },
      orderBy: { createdAt: "asc" },
      include: {
        job: { select: { id: true, clientName: true } },
      },
    });

    const ratings30 = ratings90.filter((r) => r.createdAt >= thirtyDaysAgo);

    const ratingMap = await getRatingMultiplierMap();

    // Recent form ONLY — displayed as a trend, never used as a pay input.
    const rating30Day =
      ratings30.length > 0
        ? ratings30.reduce((acc, r) => acc + r.rating, 0) / ratings30.length
        : null;

    // The 0.1 rating STEP the multiplier was priced at — all-time, matching pay.
    const tierLabel =
      ratingAllTime !== null
        ? multiplierForRating(ratingAllTime, ratingMap).label
        : null;

    // The next 0.1 step and what it would pay. All-time, because that is the
    // number the cleaner actually has to move.
    let nextTierAt: number | null = null;
    let nextTierMultiplier: number | null = null;
    if (ratingAllTime !== null && ratingAllTime < 5.0) {
      const current = Math.floor(Math.max(4, ratingAllTime) * 10) / 10;
      const next = Math.min(5, Math.round((current + 0.1) * 10) / 10);
      nextTierAt = next;
      nextTierMultiplier = multiplierForRating(next, ratingMap).multiplier;
    }

    const buckets = new Map<string, { sum: number; count: number }>();
    for (const r of ratings90) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const cur = buckets.get(day) ?? { sum: 0, count: 0 };
      cur.sum += r.rating;
      cur.count += 1;
      buckets.set(day, cur);
    }

    const trend90Day: TrendPoint[] = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { sum, count }]) => ({
        date,
        average: sum / count,
        count,
      }));

    const recentSorted = [...ratings90].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    const recentRatings: RecentRating[] = recentSorted.slice(0, 10).map((r) => ({
      id: r.id,
      rating: r.rating,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      jobId: r.jobId,
      clientName: r.job?.clientName ?? null,
    }));

    // The two "oldest rating" / "expiring soon" fields are deliberately gone:
    // both existed only to explain a 30-day rating EXPIRY that no longer
    // exists. Telling a cleaner their ratings are about to lapse, beside a
    // multiplier that will not move when they do, is worse than showing
    // nothing.
    return {
      success: true,
      data: {
        currentMultiplier,
        multiplierLocked,
        ratingsRequired: STANDARD_RATINGS_REQUIRED,
        ratingAllTime,
        ratingCountAllTime,
        rating30Day,
        ratingCount30Day: ratings30.length,
        tierLabel,
        nextTierAt,
        nextTierMultiplier,
        trend90Day,
        recentRatings,
      },
    };
  } catch (error) {
    console.error("Error getting performance data:", error);
    return { success: false, error: "Failed to load performance data" };
  }
}
