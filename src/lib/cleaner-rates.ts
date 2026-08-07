import { db } from "@/db";
import { effectiveMultiplier } from "./pay-multiplier";
import { getRatingMultiplierMap } from "./pay-multiplier-config";
import {
  STANDARD_RATINGS_REQUIRED,
  type CleanerRateInput,
  type CleanerTier,
} from "./pay-tiers";

/**
 * Loads everything needed to compute each cleaner's individual pay rate:
 * payroll tier, rating stats, and the effective rating multiplier that
 * individualRate() multiplies the tier base by (awerfixes.pdf item 1).
 *
 * Rating window (Decision 2, 2026-08-06): ALL TIME with `excludedAt: null` —
 * the same window the profile and the pay tier already show. One users query,
 * one grouped-ratings aggregate and one settings read, all in parallel.
 */
export async function getCleanerRateInputs(
  userIds: (string | null | undefined)[]
): Promise<Map<string, CleanerRateInput>> {
  const ids = Array.from(new Set(userIds.filter((v): v is string => !!v)));
  const map = new Map<string, CleanerRateInput>();
  if (ids.length === 0) return map;

  const [users, grouped, ratingMap] = await Promise.all([
    db.user.findMany({
      where: { id: { in: ids } },
      // `role` is carried so payroll can tell a real assigned cleaner from an
      // admin who was auto-stamped onto Job.employeeId. It never affects the rate.
      select: { id: true, cleanerTier: true, role: true },
    }),
    db.employeeRating.groupBy({
      by: ["employeeId"],
      // Admin-excluded ratings never touch pay (item 5).
      where: { employeeId: { in: ids }, excludedAt: null },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    // The map is identical for every cleaner in the batch, so it is read ONCE
    // and rides along in the existing Promise.all at no extra latency.
    getRatingMultiplierMap(),
  ]);

  const stats = new Map(
    grouped.map((g) => [
      g.employeeId,
      { avg: g._avg.rating, count: g._count.rating },
    ])
  );

  for (const u of users) {
    const s = stats.get(u.id);
    const avgRating = s?.avg ?? null;
    const ratingCount = s?.count ?? 0;
    map.set(u.id, {
      id: u.id,
      tier: (u.cleanerTier as CleanerTier) ?? "STANDARD",
      avgRating,
      ratingCount,
      // 1.0 until the cleaner has STANDARD_RATINGS_REQUIRED ratings — every
      // tier, not just Standard (see effectiveMultiplier).
      multiplier: effectiveMultiplier(
        avgRating,
        ratingCount,
        ratingMap,
        STANDARD_RATINGS_REQUIRED
      ),
      role: u.role ?? null,
    });
  }
  return map;
}
