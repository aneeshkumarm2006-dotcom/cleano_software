// What one job paid one cleaner, and why: the part of getPayBreakdown that
// decides the cleaner's figure, shared by the web's pay modal
// (app/admin/actions/getPayBreakdown.ts) and GET /api/v1/pay/jobs/:jobId.
//
// Moved, not rewritten: the share comes from computeJobPayShares (the number
// payroll pays), and the rating-boost decision is the one the modal already
// made. Nothing here reads a price, a charge, a tier or a pool into a cleaner's
// answer; the admin payload keeps doing that in the action, as before.
import "server-only";

import type { JobPayResponse } from "@bookmops/api/v1";
import { STANDARD_RATINGS_REQUIRED, type CleanerRateInput } from "@bookmops/core/pay";
import { jobTypeLabel } from "@bookmops/core/services";
import type { Prisma } from "@prisma/client";

import type { CleanerPayBreakdown, JobPayType } from "@/app/admin/actions/getPayBreakdown.types";
import {
  EMPTY_PAY_SHARE,
  computeJobPayShares,
  jobEffectiveDate,
  liveAssignments,
  type JobPayInput,
  type JobPayShare,
} from "@/lib/cleaner-earnings";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { jobPayBasis } from "@/lib/job-money";
import { db } from "@/lib/org-db";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import { toCents } from "@/lib/withdrawal-rules";

import type { Actor } from "../actor";
import { jobArea } from "../jobs/area";
import { notFound, ok, type Result } from "../result";

/** What the pay math needs from a job, loaded the way the modal loads it. */
export const JOB_PAY_BREAKDOWN_INCLUDE = {
  employee: true,
  cleaners: true,
  addOns: true,
  // Manual per-cleaner pay overrides — without these the number a cleaner
  // sees would disagree with what payroll actually pays them. `status` so a
  // CANCELLED row (a cleaner who left the job) is not read as a live
  // assignment by the pay math (Sept 10, items 3 + 5).
  assignments: {
    select: {
      cleanerId: true,
      payAmount: true,
      status: true,
      // This cleaner's own $/hr on this job (Sept 17, item 22).
      hourlyRate: true,
    },
  },
  // THE CLOCK (round 4, fix 5): an HOURLY job is settled from these rows.
  workSessions: {
    select: { cleanerId: true, startedAt: true, endedAt: true },
  },
  breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },
} satisfies Prisma.JobInclude;

export type PayBreakdownJob = Prisma.JobGetPayload<{ include: typeof JOB_PAY_BREAKDOWN_INCLUDE }>;

export interface JobPayContext {
  payType: JobPayType;
  shares: Map<string, JobPayShare>;
  /** The viewer's share: what they are paid for the job. */
  share: JobPayShare;
  payBasis: number;
  viewerRate: CleanerRateInput | undefined;
  hasOverride: boolean;
  payIsManual: boolean;
  multiplierApplies: boolean;
}

/**
 * The viewer's pay on `job`, through the ONE route payroll uses. `viewerId`
 * is decided by the caller (the session's own person, or for an admin the
 * lead), never taken from a request.
 */
export function jobPayContext(
  job: PayBreakdownJob,
  viewerId: string,
  rateInputs: Map<string, CleanerRateInput>,
): JobPayContext {
  const payType = (job.payType as JobPayType) ?? "PERCENTAGE";
  const shares = computeJobPayShares(job as unknown as JobPayInput, rateInputs);
  const share = shares.get(viewerId) ?? EMPTY_PAY_SHARE;
  // THE basis the percentage model is a fraction of (fix 5), not `job.price`.
  const payBasis = jobPayBasis(job);
  const viewerRate = rateInputs.get(viewerId);
  // Live rows only, the same set `computeJobPayShares` honours an override for.
  const hasOverride = liveAssignments(job as unknown as JobPayInput).some(
    (a) => a.cleanerId === viewerId && a.payAmount != null,
  );
  // D2 — the admin (or the BookingKoala CSV) stated the crew's total outright.
  const payIsManual = job.employeePayIsManual === true;
  // The multiplier only shapes the PERCENTAGE-of-basis path.
  const multiplierApplies = payType === "PERCENTAGE" && !hasOverride && !payIsManual && payBasis > 0;
  return { payType, shares, share, payBasis, viewerRate, hasOverride, payIsManual, multiplierApplies };
}

/** Whether the viewer's rating is lifting their pay on this job, and why not. */
export function ratingBoostFor(ctx: JobPayContext): CleanerPayBreakdown["ratingBoost"] {
  if (ctx.hasOverride || ctx.payIsManual) return { state: "NOT_APPLICABLE", reason: "FIXED_AMOUNT" };
  if (!ctx.multiplierApplies) {
    return { state: "NOT_APPLICABLE", reason: ctx.payType === "HOURLY" ? "HOURLY" : "FLAT" };
  }
  if ((ctx.viewerRate?.ratingCount ?? 0) < STANDARD_RATINGS_REQUIRED) {
    return {
      state: "LOCKED",
      ratingsSoFar: ctx.viewerRate?.ratingCount ?? 0,
      ratingsRequired: STANDARD_RATINGS_REQUIRED,
    };
  }
  return {
    state: "APPLIED",
    multiplier: ctx.viewerRate?.multiplier ?? 1,
    averageRating: ctx.viewerRate?.avgRating ?? null,
  };
}

/** Every participant's rate: the tier split needs the whole team. */
export function participantIdsOf(job: { employeeId: string | null; cleaners: { id: string }[] }): string[] {
  return Array.from(new Set([job.employeeId, ...job.cleaners.map((c) => c.id)].filter((id): id is string => !!id)));
}

/**
 * GET /api/v1/pay/jobs/:jobId — the caller's own pay on a job they lead or
 * are on. Anything else (not theirs, deleted, another company's) is 404.
 */
export async function jobPayFor(actor: Actor, jobId: string): Promise<Result<JobPayResponse>> {
  const job = await db.job.findFirst({
    where: {
      id: jobId,
      deletedAt: null,
      OR: [{ employeeId: actor.userId }, { cleaners: { some: { id: actor.userId } } }],
    },
    include: { ...JOB_PAY_BREAKDOWN_INCLUDE, clientAddress: { select: { city: true } } },
  });
  if (!job) return notFound("We couldn't find that job.");

  const [rateInputs, { labels }] = await Promise.all([
    getCleanerRateInputs(participantIdsOf(job)),
    getServiceCatalogWithLabels(),
  ]);
  const ctx = jobPayContext(job, actor.userId, rateInputs);
  const boost = ratingBoostFor(ctx);
  const date = jobEffectiveDate(job as unknown as JobPayInput) ?? job.startTime;

  return ok({
    jobId: job.id,
    date: date.toISOString(),
    area: jobArea(job),
    service: jobTypeLabel(job.jobType, labels) || "Cleaning",
    basis: ctx.share.basis,
    basisLabel: ctx.share.basisLabel,
    hourlyRateCents: ctx.payType === "HOURLY" && job.hourlyRate != null ? toCents(job.hourlyRate) : null,
    workCents: toCents(ctx.share.base),
    tipCents: toCents(ctx.share.tip),
    parkingCents: toCents(ctx.share.parking),
    totalCents: toCents(ctx.share.total),
    ratingBoost: {
      state: boost.state,
      multiplier: boost.state === "APPLIED" ? boost.multiplier : null,
      ratingsSoFar: boost.state === "LOCKED" ? boost.ratingsSoFar : null,
      ratingsRequired: boost.state === "LOCKED" ? boost.ratingsRequired : null,
      reason: boost.state === "NOT_APPLICABLE" ? boost.reason : null,
    },
  });
}
