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
import {
  STANDARD_RATINGS_REQUIRED,
  tierBaseRate,
  type CleanerTier,
} from "@/lib/pay-tiers";
import { computeJobPayShares, type JobPayInput } from "@/lib/cleaner-earnings";
import { computeJobMoney } from "@/lib/job-money";
import { getTaxRates } from "@/lib/tax.server";

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
        // Manual per-cleaner pay overrides — without these the number a cleaner
        // sees here would disagree with what payroll actually pays them.
        assignments: { select: { cleanerId: true, payAmount: true } },
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

    // ONE route. This file used to compute the payout TWICE — cleanerJobPay
    // here AND computeJobPayout further down — and the two disagreed on every
    // job with a manual override, every FLAT/HOURLY job, and every job still
    // carrying an ADMIN on employeeId (computeJobPayout has no equivalent of
    // the jobParticipantIds guard, so it paid the phantom and inflated
    // poolTotal). Same math as payroll, so the number a cleaner sees here is
    // the number they get paid.
    const shares = computeJobPayShares(
      job as unknown as JobPayInput,
      rateInputs
    );
    const share = shares.get(viewerId) ?? {
      base: 0,
      afterMultiplier: 0,
      tip: 0,
      total: 0,
      hours: 0,
    };

    const viewerRate = rateInputs.get(viewerId);
    const hasOverride = job.assignments.some(
      (a) => a.cleanerId === viewerId && a.payAmount != null
    );
    // The multiplier only shapes the PERCENTAGE-of-price path. A manual
    // override, a FLAT total or an HOURLY amount is the figure the admin typed
    // and is paid through untouched.
    const multiplierApplies =
      payType === "PERCENTAGE" && !hasOverride && (job.price ?? 0) > 0;

    // ── Cleaner (and any non-admin) payload: payout only. ────────────────────
    if (!isAdmin) {
      const ratingBoost: CleanerPayBreakdown["ratingBoost"] = hasOverride
        ? { state: "NOT_APPLICABLE", reason: "FIXED_AMOUNT" }
        : !multiplierApplies
          ? {
              state: "NOT_APPLICABLE",
              reason: payType === "HOURLY" ? "HOURLY" : "FLAT",
            }
          : (viewerRate?.ratingCount ?? 0) < STANDARD_RATINGS_REQUIRED
            ? {
                state: "LOCKED",
                ratingsSoFar: viewerRate?.ratingCount ?? 0,
                ratingsRequired: STANDARD_RATINGS_REQUIRED,
              }
            : {
                state: "APPLIED",
                multiplier: viewerRate?.multiplier ?? 1,
                averageRating: viewerRate?.avgRating ?? null,
              };

      const redacted: CleanerPayBreakdown = {
        audience: "CLEANER",
        jobId: job.id,
        clientName: job.clientName,
        payType,
        hourlyRate: payType === "HOURLY" ? job.hourlyRate ?? null : null,
        tipShare: share.tip,
        totalEmployeePay: share.total,
        ratingBoost,
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

    // Display figures only — cleaner pay comes from computeJobPayShares above,
    // which reads `job.price` directly and is untouched by any of this.
    // `job.price - addOnsTotal` was web-shaped and understated an admin job's
    // base by the whole add-on total, since an admin `price` never contained
    // them in the first place.
    const money = computeJobMoney(job, await getTaxRates());
    const addOnsTotal = money.addOnTotal;

    if (basePrice === null && job.price !== null) {
      basePrice = money.basePrice;
      basePriceSource = "JOB_PRICE";
    }

    const discount = job.discountAmount || 0;
    const parking = job.parking || 0;
    const clientTotal = money.totalAmount;

    const viewerTier = (viewerRate?.tier as CleanerTier) ?? "STANDARD";
    const resolvedMultiplier = viewerRate?.multiplier ?? 1.0;
    const poolTotal =
      Math.round(
        [...shares.values()].reduce((sum, s) => sum + s.base, 0) * 100
      ) / 100;

    const breakdown: AdminPayBreakdown = {
      audience: "ADMIN",
      jobId: job.id,
      clientName: job.clientName,
      bedCount: job.bedCount,
      bathCount: job.bathCount,
      basePrice,
      basePriceSource,
      addOns: money.addOnLines.map((a) => ({
        name: a.name,
        price: a.unitPrice,
        quantity: a.quantity,
        lineTotal: a.lineTotal,
      })),
      addOnsTotal,
      discount,
      parking,
      clientTotal,
      payType,
      hourlyRate: job.hourlyRate ?? null,
      // Pay at the bare TIER BASE rate, so the before/after below is a real
      // comparison rather than the same number printed twice (the multiplier is
      // folded into the rate now, not applied to the finished amount).
      employeeBasePay: multiplierApplies
        ? Math.round((job.price ?? 0) * tierBaseRate(viewerTier) * 100) / 100
        : share.base,
      // The RESOLVED cleaner multiplier. This used to read the deprecated
      // per-job column, which both save paths hard-reset to 1.0 and nothing
      // reads any more. The premium belongs to the CLEANER, not the job.
      payMultiplier: resolvedMultiplier,
      payMultiplierApplies: multiplierApplies,
      payMultiplierSource: multiplierApplies
        ? `${viewerRate?.avgRating?.toFixed(2) ?? "—"}★ all-time · ${viewerRate?.ratingCount ?? 0} ratings`
        : hasOverride
          ? "Manual per-cleaner amount — no multiplier"
          : `${payType} pay — no multiplier`,
      payAfterMultiplier: share.base,
      totalTip: job.totalTip || 0,
      teamSize: shares.size,
      tipShare: share.tip,
      totalEmployeePay: share.total,
      isLead,
      tier: viewerTier,
      individualRate: multiplierApplies
        ? Math.round(tierBaseRate(viewerTier) * resolvedMultiplier * 10000) /
          10000
        : 0,
      isSplit: shares.size > 1,
      poolTotal,
    };

    return { success: true, breakdown };
  } catch (error) {
    console.error("Error getting pay breakdown:", error);
    return { success: false, error: "Failed to load pay breakdown" };
  }
}
