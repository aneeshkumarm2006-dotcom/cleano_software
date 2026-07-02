"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { computeJobPayout } from "@/lib/pay-tiers";
import { getFieldLeadWeeklyBonus } from "@/lib/field-lead-bonus.server";

export async function createPayPeriod(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const startDateStr = formData.get("startDate") as string;
  const endDateStr = formData.get("endDate") as string;
  const notes = (formData.get("notes") as string) || null;

  if (!startDateStr || !endDateStr) {
    return { error: "Start and end dates are required" };
  }

  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { error: "Invalid dates" };
  }

  if (endDate < startDate) {
    return { error: "End date must be on or after start date" };
  }

  const rangeEnd = new Date(endDate);
  rangeEnd.setHours(23, 59, 59, 999);

  try {
    const employees = await db.user.findMany({
      where: { role: { in: ["EMPLOYEE", "ADMIN", "OWNER"] } },
      select: { id: true, payMultiplier: true },
    });

    const jobs = await db.job.findMany({
      where: {
        status: { in: ["COMPLETED", "PAID"] },
        OR: [
          { jobDate: { gte: startDate, lte: rangeEnd } },
          {
            AND: [
              { jobDate: null },
              { startTime: { gte: startDate, lte: rangeEnd } },
            ],
          },
        ],
      },
      select: {
        id: true,
        employeeId: true,
        employeePay: true,
        totalTip: true,
        payRateMultiplier: true,
        price: true,
        clockInTime: true,
        clockOutTime: true,
        startTime: true,
        endTime: true,
        cleaners: { select: { id: true } },
      },
    });

    // Load each participating cleaner's tier + rating so the proportional
    // split (src/lib/pay-tiers.ts) can compute individual rates.
    const allParticipantIds = jobs.flatMap((j) => [
      j.employeeId,
      ...j.cleaners.map((c) => c.id),
    ]);
    const rateInputs = await getCleanerRateInputs(allParticipantIds);

    const payoutMap = new Map<
      string,
      { base: number; jobCount: number; hours: number }
    >();
    for (const emp of employees) {
      payoutMap.set(emp.id, { base: 0, jobCount: 0, hours: 0 });
    }

    for (const job of jobs) {
      const cleanerIds = job.cleaners.map((c) => c.id);
      const participantIds = Array.from(
        new Set(
          [job.employeeId, ...cleanerIds].filter(
            (id): id is string => !!id
          )
        )
      );
      if (participantIds.length === 0) continue;

      const jobMultiplier = job.payRateMultiplier ?? 1;
      const totalTip = job.totalTip || 0;
      const tipShare = totalTip / participantIds.length;

      // Tier-based proportional payout from the job price. Falls back to an even
      // split of the stored employeePay for legacy jobs that have no price.
      const rateList = participantIds.map(
        (id) =>
          rateInputs.get(id) ?? {
            id,
            tier: "STANDARD" as const,
            avgRating: null,
            ratingCount: 0,
          }
      );
      const payout = computeJobPayout(job.price, rateList);
      const amountById = new Map(payout.shares.map((s) => [s.id, s.amount]));
      const legacyPerPerson =
        (job.employeePay || 0) / participantIds.length;

      const start = job.clockInTime ?? job.startTime;
      const end = job.clockOutTime ?? job.endTime;
      let hours = 0;
      if (start && end) {
        hours = Math.max(
          0,
          (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000
        );
      }
      const perPersonHours = hours / participantIds.length;

      const usePriceModel = (job.price ?? 0) > 0;

      for (const pid of participantIds) {
        if (!payoutMap.has(pid)) {
          payoutMap.set(pid, { base: 0, jobCount: 0, hours: 0 });
        }
        const entry = payoutMap.get(pid)!;
        const cleanerPay = usePriceModel
          ? amountById.get(pid) ?? 0
          : legacyPerPerson;
        entry.base += cleanerPay * jobMultiplier + tipShare;
        entry.jobCount += 1;
        entry.hours += perPersonHours;
      }
    }

    // Field Lead weekly group-revenue bonus (2% / 3% by group avg rating).
    // Computed over the pay-period window for every Field Lead-tier cleaner.
    const fieldLeads = await db.user.findMany({
      where: { cleanerTier: "FIELD_LEAD" },
      select: { id: true },
    });
    for (const fl of fieldLeads) {
      const bonus = await getFieldLeadWeeklyBonus(fl.id, startDate, rangeEnd);
      if (bonus.bonusAmount <= 0) continue;
      if (!payoutMap.has(fl.id)) {
        payoutMap.set(fl.id, { base: 0, jobCount: 0, hours: 0 });
      }
      payoutMap.get(fl.id)!.base += bonus.bonusAmount;
    }

    const payPeriod = await db.payPeriod.create({
      data: {
        startDate,
        endDate,
        notes,
        status: "DRAFT",
        payouts: {
          create: Array.from(payoutMap.entries())
            .filter(([, v]) => v.jobCount > 0 || v.base > 0)
            .map(([employeeId, v]) => ({
              employeeId,
              baseAmount: Number(v.base.toFixed(2)),
              finalAmount: Number(v.base.toFixed(2)),
              jobCount: v.jobCount,
              totalHours: Number(v.hours.toFixed(2)),
            })),
        },
      },
    });

    revalidatePath("/admin/payouts");
    return { success: true, payPeriodId: payPeriod.id };
  } catch (error) {
    console.error("Error creating pay period:", error);
    return { error: "Failed to create pay period" };
  }
}
