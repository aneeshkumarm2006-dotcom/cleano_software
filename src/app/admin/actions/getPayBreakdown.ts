"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { PayBreakdown } from "./getPayBreakdown.types";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { computeJobPayout, type CleanerTier } from "@/lib/pay-tiers";

export async function getPayBreakdown(
  jobId: string
): Promise<
  | { success: true; breakdown: PayBreakdown }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        employee: true,
        cleaners: true,
        addOns: true,
      },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const isLead = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some((c) => c.id === session.user.id);
    const isAdmin =
      (session.user as any).role === "ADMIN" ||
      (session.user as any).role === "OWNER";

    if (!isLead && !isCleaner && !isAdmin) {
      return { success: false, error: "You do not have access to this job" };
    }

    let basePrice: number | null = null;
    let basePriceSource: PayBreakdown["basePriceSource"] = "NONE";

    if (job.bedCount !== null && job.bathCount !== null) {
      const rule = await db.pricingRule.findUnique({
        where: {
          bedCount_bathCount: {
            bedCount: job.bedCount,
            bathCount: job.bathCount,
          },
        },
      });
      if (rule && rule.isActive) {
        basePrice = rule.basePrice;
        basePriceSource = "PRICING_RULE";
      }
    }

    const addOnsTotal = job.addOns.reduce((sum, a) => sum + (a.price || 0), 0);

    if (basePrice === null && job.price !== null) {
      basePrice = Math.max(0, job.price - addOnsTotal);
      basePriceSource = "JOB_PRICE";
    }

    const discount = job.discountAmount || 0;
    const parking = job.parking || 0;

    const clientTotal =
      job.price !== null
        ? job.price
        : (basePrice ?? 0) + addOnsTotal - discount;

    // Tier-based pay: compute the proportional split from the job price. The
    // "viewer" is the current cleaner if they're on the job, otherwise the lead
    // (so admins see the lead's pay).
    const participantIds = Array.from(
      new Set(
        [job.employeeId, ...job.cleaners.map((c) => c.id)].filter(
          (id): id is string => !!id
        )
      )
    );
    const rateInputs = await getCleanerRateInputs(participantIds);
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

    const viewerId =
      isCleaner || isLead ? session.user.id : job.employeeId ?? participantIds[0];
    const viewerShare = payout.shares.find((s) => s.id === viewerId);
    const viewerRate = rateInputs.get(viewerId ?? "");

    const teamSize = 1 + job.cleaners.length;
    const usePriceModel = (job.price ?? 0) > 0;

    // Base pay (before the per-job multiplier/tip): tier share, or legacy even
    // split of the stored employeePay for jobs with no price.
    const employeeBasePay = usePriceModel
      ? viewerShare?.amount ?? 0
      : (job.employeePay || 0) / (teamSize || 1);
    const payMultiplier = job.payRateMultiplier ?? 1.0;

    const payAfterMultiplier = employeeBasePay * payMultiplier;

    const totalTip = job.totalTip || 0;
    const tipShare = teamSize > 0 ? totalTip / teamSize : 0;

    const totalEmployeePay = payAfterMultiplier + tipShare;

    return {
      success: true,
      breakdown: {
        jobId: job.id,
        clientName: job.clientName,
        bedCount: job.bedCount,
        bathCount: job.bathCount,
        basePrice,
        basePriceSource,
        addOns: job.addOns.map((a) => ({ name: a.name, price: a.price })),
        addOnsTotal,
        discount,
        parking,
        clientTotal,
        employeeBasePay,
        payMultiplier,
        payAfterMultiplier,
        totalTip,
        teamSize,
        tipShare,
        totalEmployeePay,
        isLead,
        tier: (viewerRate?.tier as CleanerTier) ?? "STANDARD",
        individualRate: viewerShare?.rate ?? 0,
        isSplit: payout.isSplit,
        poolTotal: payout.pool,
      },
    };
  } catch (error) {
    console.error("Error getting pay breakdown:", error);
    return { success: false, error: "Failed to load pay breakdown" };
  }
}
