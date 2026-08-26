"use server";

import { db } from "@/lib/org-db";
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
import {
  EMPTY_PAY_SHARE,
  computeJobPayShares,
  type JobPayInput,
} from "@/lib/cleaner-earnings";
import { computeJobMoney, jobPayBasis } from "@/lib/job-money";
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
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        employee: true,
        cleaners: true,
        addOns: true,
        // Manual per-cleaner pay overrides — without these the number a cleaner
        // sees here would disagree with what payroll actually pays them.
        assignments: { select: { cleanerId: true, payAmount: true } },
        // THE CLOCK (round 4, fix 5). An HOURLY job is now settled from these
        // rows — each cleaner's own sessions × the rate — so a payload built
        // without them falls back to splitting the stored team total evenly and
        // this modal quotes a cleaner a different figure from the one payroll
        // pays. `include` loads scalars but never relations, which is exactly
        // how they were missing: nothing here asked for them.
        workSessions: {
          select: { cleanerId: true, startedAt: true, endedAt: true },
        },
        breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },
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
    const share = shares.get(viewerId) ?? EMPTY_PAY_SHARE;

    // THE basis the percentage model is a fraction of (fix 5). Not `job.price`:
    // that is the base service line, and every add-on and custom extra charge
    // used to be invisible to this whole file.
    const payBasis = jobPayBasis(job);

    const viewerRate = rateInputs.get(viewerId);
    const hasOverride = job.assignments.some(
      (a) => a.cleanerId === viewerId && a.payAmount != null
    );
    // D2 — the admin (or the BookingKoala CSV) stated the crew's total outright,
    // so no rate and no multiplier is involved for anyone on this job.
    const payIsManual = job.employeePayIsManual === true;
    // The multiplier only shapes the PERCENTAGE-of-basis path. A manual team
    // total, a manual per-cleaner override, a FLAT total or an HOURLY amount is
    // the figure the admin typed and is paid through untouched.
    const multiplierApplies =
      payType === "PERCENTAGE" && !hasOverride && !payIsManual && payBasis > 0;

    // ── Cleaner (and any non-admin) payload: payout only. ────────────────────
    if (!isAdmin) {
      const ratingBoost: CleanerPayBreakdown["ratingBoost"] = hasOverride ||
        payIsManual
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
