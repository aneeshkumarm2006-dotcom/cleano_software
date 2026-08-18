import { db } from "@/db";
import { computeFieldLeadBonus, type FieldLeadBonus } from "./field-lead-bonus";
import { fieldLeadGroupIds } from "./field-lead-group.server";
import { ACTIVE_VALUE_SELECT } from "./metrics";
import { activeSubtotal } from "./job-money";

// The Field Lead's "group" = the Field Lead plus every cleaner whose
// fieldLeadId points at them. Weekly revenue is the total ACTIVE value of the
// group's COMPLETED/PAID jobs in the window; the group average rating is the
// mean of EmployeeRating rows logged for group members in the window.
export async function getFieldLeadWeeklyBonus(
  fieldLeadId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<FieldLeadBonus & { groupMemberIds: string[] }> {
  // Stage 7 moved this resolution into a shared helper so the bonus, the My Team
  // page, the calendar scope and the availability read cannot disagree about who
  // is in a group.
  //
  // `includeArchived: true` reproduces the pre-refactor set EXACTLY — this query
  // never filtered `deletedAt`, and it must not start now: the window is
  // historical, so a cleaner archived mid-week still worked the jobs they worked,
  // and excluding them would silently shrink a Field Lead's group revenue for a
  // week they had already earned. The My Team surfaces use the default (active
  // only), because an archived cleaner has no upcoming schedule to coordinate.
  const groupMemberIds = await fieldLeadGroupIds(fieldLeadId, {
    includeArchived: true,
  });

  // Revenue: jobs the group worked (as lead employee or assigned cleaner) that
  // completed in the window. Distinct jobs so a shared job isn't double-counted.
  const jobs = await db.job.findMany({
    where: {
      deletedAt: null,
      status: { in: ["COMPLETED", "PAID"] },
      AND: [
        {
          OR: [
            { jobDate: { gte: weekStart, lte: weekEnd } },
            {
              AND: [
                { jobDate: null },
                { startTime: { gte: weekStart, lte: weekEnd } },
              ],
            },
          ],
        },
        {
          OR: [
            { employeeId: { in: groupMemberIds } },
            { cleaners: { some: { id: { in: groupMemberIds } } } },
          ],
        },
      ],
    },
    select: { id: true, ...ACTIVE_VALUE_SELECT },
  });
  // Fix 3 item 3.7 — the bonus denominator is the same revenue basis every
  // other report uses: base + add-ons, or the override total. On `price` alone
  // a Field Lead's group was credited $128 for a job that billed $186 of work,
  // which could put a genuinely qualifying week under the threshold.
  const groupRevenue = jobs.reduce((sum, j) => sum + activeSubtotal(j), 0);

  // Group average rating for the window. `excludedAt: null` matches every other
  // rating→money path (cleaner-rates.ts, getPerformanceData,
  // recalculateMultiplier): an admin-excluded rating must never move pay
  // (AwerNewFixes.pdf item 5). Without it, an unfair 1-star an admin had
  // already thrown out still dragged the group average below the bonus
  // threshold and cost the Field Lead real money.
  //
  // The WINDOW stays weekly on purpose — Decision 2's all-time rule governs the
  // rating MULTIPLIER, not this weekly group bonus.
  const ratingAgg = await db.employeeRating.aggregate({
    where: {
      employeeId: { in: groupMemberIds },
      excludedAt: null,
      createdAt: { gte: weekStart, lte: weekEnd },
    },
    _avg: { rating: true },
  });
  const groupAvgRating = ratingAgg._avg.rating ?? null;

  return {
    ...computeFieldLeadBonus(groupRevenue, groupAvgRating),
    groupMemberIds,
  };
}
