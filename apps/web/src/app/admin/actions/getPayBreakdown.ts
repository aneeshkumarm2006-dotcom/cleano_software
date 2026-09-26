"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type {
  AdminPayBreakdown,
  CleanerPayBreakdown,
  PayBreakdown,
} from "./getPayBreakdown.types";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { tierBaseRate, type CleanerTier } from "@bookmops/core/pay";
import { computeJobMoney } from "@/lib/job-money";
import {
  JOB_PAY_BREAKDOWN_INCLUDE,
  jobPayContext,
  participantIdsOf,
  ratingBoostFor,
} from "@/server/pay/job-pay";
import { hourlyLineLabel } from "@/lib/hourly-billing";
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
    // The include lives beside the shared pay math (server/pay/job-pay.ts):
    // the manual overrides, the assignment status and the clock rows it
    // carries are exactly what the figure a cleaner sees depends on.
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: JOB_PAY_BREAKDOWN_INCLUDE,
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

    const participantIds = participantIdsOf(job);
    const rateInputs = await getCleanerRateInputs(participantIds);

    // The "viewer" is the current cleaner when they're on the job, otherwise the
    // lead (so an admin sees the lead's pay).
    const viewerId =
      isCleaner || isLead
        ? session.user.id
        : job.employeeId ?? participantIds[0] ?? "";

    // ONE route: the share comes from computeJobPayShares, the same math as
    // payroll, so the number a cleaner sees here is the number they get paid.
    // The decision (basis, override, manual total, whether the rating
    // multiplier applies) is shared with GET /api/v1/pay/jobs/:id.
    const pay = jobPayContext(job, viewerId, rateInputs);
    const { payType, shares, share, payBasis, viewerRate, hasOverride, payIsManual, multiplierApplies } = pay;

    // ── Cleaner (and any non-admin) payload: payout only. ────────────────────
    if (!isAdmin) {
      const ratingBoost: CleanerPayBreakdown["ratingBoost"] = ratingBoostFor(pay);

      const redacted: CleanerPayBreakdown = {
        audience: "CLEANER",
        jobId: job.id,
        clientName: job.clientName,
        payType,
        // Round 4, fix 5 — off the share that produced the amount, never
        // re-derived. On an hourly job this is what tells the cleaner their pay
        // came from the clock, and with how many hours on it.
        basis: share.basis,
        basisLabel: share.basisLabel,
        hourlyRate: payType === "HOURLY" ? job.hourlyRate ?? null : null,
        tipShare: share.tip,
        parkingShare: share.parking,
        totalEmployeePay: share.total,
        ratingBoost,
      };
      return { success: true, breakdown: redacted };
    }

    // ── Admin payload: full internal breakdown. ──────────────────────────────
    let basePrice: number | null = null;
    let basePriceSource: AdminPayBreakdown["basePriceSource"] = "NONE";

    if (job.bedCount !== null && job.bathCount !== null) {
      const rule = await db.pricingRule.findFirst({
        where: { bedCount: job.bedCount, bathCount: job.bathCount },
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
      // Stage 8 — how the CUSTOMER is billed. Present only in this ADMIN
      // payload: the rate is a client charge, and the cleaner payload above is
      // built to contain nothing but the cleaner's own money.
      billingType: job.billingType === "HOURLY" ? "HOURLY" : "FLAT",
      billedHourlyRate: job.billedHourlyRate ?? null,
      billedEstimatedHours: job.billedEstimatedHours ?? null,
      billedActualHours: job.billedActualHours ?? null,
      billedHourlyLine: hourlyLineLabel(job),
      payType,
      hourlyRate: job.hourlyRate ?? null,
      // The same two fields the cleaner payload carries, from the same share.
      basis: share.basis,
      basisLabel: share.basisLabel,
      // Pay at the bare TIER BASE rate, so the before/after below is a real
      // comparison rather than the same number printed twice (the multiplier is
      // folded into the rate now, not applied to the finished amount).
      //
      // Off the PAY BASIS, not `job.price` (fix 5): with the bare price this row
      // understated the "before" figure by the whole add-on total, so the
      // multiplier column appeared to be worth far more than it is.
      employeeBasePay: multiplierApplies
        ? Math.round(payBasis * tierBaseRate(viewerTier) * 100) / 100
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
          : payIsManual
            ? "Manual team total — split evenly, no multiplier"
            : `${payType} pay — no multiplier`,
      payAfterMultiplier: share.base,
      totalTip: job.totalTip || 0,
      teamSize: shares.size,
      tipShare: share.tip,
      parkingShare: share.parking,
      payBasis,
      payIsManual,
      totalEmployeePay: share.total,
      isLead,
      tier: viewerTier,
      individualRate: multiplierApplies
        ? Math.round(tierBaseRate(viewerTier) * resolvedMultiplier * 10000) /
          10000
        : 0,
      // The company's labour cost for the job: every cleaner's BASE, excluding
      // the tip and parking shares that are the customer's money in transit.
      isSplit: shares.size > 1,
      poolTotal,
    };

    return { success: true, breakdown };
  } catch (error) {
    console.error("Error getting pay breakdown:", error);
    return { success: false, error: "Failed to load pay breakdown" };
  }
}
