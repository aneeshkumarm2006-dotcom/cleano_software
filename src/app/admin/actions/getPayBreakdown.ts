"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type {
  AdminPayBreakdown,
  CleanerPayBreakdown,
  JobPayType,
  PayBreakdown,
} from "./getPayBreakdown.types";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { computeJobPayout, type CleanerTier } from "@/lib/pay-tiers";
import { cleanerJobPay, type JobPayInput } from "@/lib/cleaner-earnings";

/**
 * Pay breakdown for one job.
 *
 * AUTHZ: the caller must be the job's lead, an assigned cleaner, or an
 * ADMIN/OWNER. Anything else is denied (fail closed).
 *
 * REDACTION (item 1): only ADMIN/OWNER get the internal breakdown (client
 * charges, base price, discounts, tier, % of price, split-pool math). Everyone
 * else — including the cleaners on the job — gets a payload that contains
 * nothing but their own payout, so the internal numbers can't be read off the
 * wire either.
 */
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

  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64) {
    return { success: false, error: "Invalid request" };
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
    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "ADMIN" || role === "OWNER";

    if (!isLead && !isCleaner && !isAdmin) {
      return { success: false, error: "You do not have access to this job" };
    }

    const payType = (job.payType as JobPayType) ?? "PERCENTAGE";
    const participantIds = Array.from(
      new Set(
        [job.employeeId, ...job.cleaners.map((c) => c.id)].filter(
          (id): id is string => !!id
        )
      )
    );
    const rateInputs = await getCleanerRateInputs(participantIds);

    // The "viewer" is the current cleaner when they're on the job, otherwise the
    // lead (so an admin sees the lead's pay).
    const viewerId =
      isCleaner || isLead
        ? session.user.id
        : job.employeeId ?? participantIds[0] ?? "";

    // Same math as payroll (src/lib/cleaner-earnings.ts) so the number a cleaner
    // sees here is the number they get paid.
    const share = cleanerJobPay(job as unknown as JobPayInput, rateInputs, viewerId);

    // ── Cleaner (and any non-admin) payload: payout only. ────────────────────
    if (!isAdmin) {
      const redacted: CleanerPayBreakdown = {
        audience: "CLEANER",
        jobId: job.id,
        clientName: job.clientName,
        payType,
        hourlyRate: payType === "HOURLY" ? job.hourlyRate ?? null : null,
        tipShare: share.tip,
        totalEmployeePay: share.total,
      };
      return { success: true, breakdown: redacted };
    }

    // ── Admin payload: full internal breakdown. ──────────────────────────────
    let basePrice: number | null = null;
    let basePriceSource: AdminPayBreakdown["basePriceSource"] = "NONE";

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
    const viewerShare = payout.shares.find((s) => s.id === viewerId);
    const viewerRate = rateInputs.get(viewerId);

    const breakdown: AdminPayBreakdown = {
      audience: "ADMIN",
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
      payType,
      hourlyRate: job.hourlyRate ?? null,
      employeeBasePay: share.base,
      payMultiplier: job.payRateMultiplier ?? 1.0,
      payAfterMultiplier: share.afterMultiplier,
      totalTip: job.totalTip || 0,
      teamSize: participantIds.length,
      tipShare: share.tip,
      totalEmployeePay: share.total,
      isLead,
      tier: (viewerRate?.tier as CleanerTier) ?? "STANDARD",
      individualRate: viewerShare?.rate ?? 0,
      isSplit: payout.isSplit,
      poolTotal: payout.pool,
    };

    return { success: true, breakdown };
  } catch (error) {
    console.error("Error getting pay breakdown:", error);
    return { success: false, error: "Failed to load pay breakdown" };
  }
}
