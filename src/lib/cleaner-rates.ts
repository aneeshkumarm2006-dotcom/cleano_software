import { db } from "@/db";
import type { CleanerRateInput, CleanerTier } from "./pay-tiers";

// Loads the payroll-tier + rating stats needed to compute each cleaner's
// individual pay rate. Runs one users query + one grouped-ratings aggregate.
export async function getCleanerRateInputs(
  userIds: (string | null | undefined)[]
): Promise<Map<string, CleanerRateInput>> {
  const ids = Array.from(new Set(userIds.filter((v): v is string => !!v)));
  const map = new Map<string, CleanerRateInput>();
  if (ids.length === 0) return map;

  const [users, grouped] = await Promise.all([
    db.user.findMany({
      where: { id: { in: ids } },
      // `role` is carried so payroll can tell a real assigned cleaner from an
      // admin who was auto-stamped onto Job.employeeId. It never affects the rate.
      select: { id: true, cleanerTier: true, role: true },
    }),
    db.employeeRating.groupBy({
      by: ["employeeId"],
      where: { employeeId: { in: ids } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
  ]);

  const stats = new Map(
    grouped.map((g) => [
      g.employeeId,
      { avg: g._avg.rating, count: g._count.rating },
    ])
  );

  for (const u of users) {
    const s = stats.get(u.id);
    map.set(u.id, {
      id: u.id,
      tier: (u.cleanerTier as CleanerTier) ?? "STANDARD",
      avgRating: s?.avg ?? null,
      ratingCount: s?.count ?? 0,
      role: u.role ?? null,
    });
  }
  return map;
}
