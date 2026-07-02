import { db } from "@/db";
import { computeFieldLeadBonus, type FieldLeadBonus } from "./field-lead-bonus";

// The Field Lead's "group" = the Field Lead plus every cleaner whose
// fieldLeadId points at them. Weekly revenue is the total price of the group's
// COMPLETED/PAID jobs in the window; the group average rating is the mean of
// EmployeeRating rows logged for group members in the window.
export async function getFieldLeadWeeklyBonus(
  fieldLeadId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<FieldLeadBonus & { groupMemberIds: string[] }> {
  const members = await db.user.findMany({
    where: { fieldLeadId },
    select: { id: true },
  });
  const groupMemberIds = [fieldLeadId, ...members.map((m) => m.id)];

  // Revenue: jobs the group worked (as lead employee or assigned cleaner) that
  // completed in the window. Distinct jobs so a shared job isn't double-counted.
  const jobs = await db.job.findMany({
    where: {
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
    select: { id: true, price: true },
  });
  const groupRevenue = jobs.reduce((sum, j) => sum + (j.price || 0), 0);

  // Group average rating for the window.
  const ratingAgg = await db.employeeRating.aggregate({
    where: {
      employeeId: { in: groupMemberIds },
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
