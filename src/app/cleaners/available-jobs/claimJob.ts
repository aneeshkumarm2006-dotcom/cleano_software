"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  isCategoryAllowed,
  CATEGORY_BLOCKED_MESSAGE,
} from "@/lib/service-permissions";
import { quoteSettledFilter } from "@/lib/cleaner-jobs";
import { isAwaitingQuote } from "@/lib/quote-status";

export async function claimJob(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as any).role;
  if (!role || role === "CLIENT") return { success: false, error: "Not authorized" };

  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64) {
    return { success: false, error: "Job not found" };
  }

  const userId = session.user.id;

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      deletedAt: true,
      status: true,
      startTime: true,
      employeeId: true,
      requiredCleaners: true,
      jobType: true,
      // Stage 11 / PDF #9 — an unsettled quote is not claimable work.
      quoteStatus: true,
      cleaners: { select: { id: true } },
    },
  });
  // Fail closed: a soft-deleted job doesn't exist as far as a cleaner is concerned.
  if (!job || job.deletedAt) return { success: false, error: "Job not found" };

  // Already ON the job — as an assigned cleaner OR as the job's LEAD. The lead
  // check was missing, so a cleaner who already led a job could "claim" it and
  // end up double-assigned (and double-counted against requiredCleaners).
  if (job.employeeId === userId) {
    return { success: false, error: "You're already assigned to this job" };
  }
  if (job.cleaners.some((c) => c.id === userId)) {
    return { success: false, error: "You already claimed this job" };
  }

  // Spec item 12: trainees can't claim solo work — only jobs that already
  // have a Field Lead or approved cleaner on the crew.
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { cleanerTier: true, allowedServiceCategories: true },
  });

  // Service category permission (awerfixes.pdf item 3). Defence in depth: the
  // board already hides these jobs, but the board is a filtered list and this is
  // the write — a stale page or a hand-made call must not get through. Empty
  // list = unrestricted; an unrecognised jobType stays claimable by everyone.
  if (!isCategoryAllowed(job.jobType, me?.allowedServiceCategories)) {
    return { success: false, error: CATEGORY_BLOCKED_MESSAGE };
  }

  if (me?.cleanerTier === "TRAINEE") {
    const crewIds = [
      ...job.cleaners.map((c) => c.id),
      ...(job.employeeId ? [job.employeeId] : []),
    ];
    const approvedOnCrew = crewIds.length
      ? await db.user.count({
          where: { id: { in: crewIds }, cleanerTier: { not: "TRAINEE" } },
        })
      : 0;
    if (approvedOnCrew === 0) {
      return {
        success: false,
        error:
          "Trainees can't claim solo jobs — this job needs a Field Lead or approved cleaner first.",
      };
    }
  }

  // Only genuinely open work is claimable — mirrors claimableJobsWhere().
  if (job.status !== "CREATED" && job.status !== "SCHEDULED") {
    return { success: false, error: "This job is no longer available" };
  }
  // An unaccepted post-construction quote is unpriced, unconfirmed work (Stage 11,
  // step 11.7). It can't be reached from the board — `claimableJobsWhere` filters
  // it out — but this action takes a jobId from the client, so the rule has to
  // exist here too or the board's filter is decorative.
  if (isAwaitingQuote(job.quoteStatus)) {
    return { success: false, error: "This job is no longer available" };
  }
  if (job.startTime.getTime() < Date.now()) {
    return { success: false, error: "This job has already started" };
  }
  if (job.cleaners.length >= job.requiredCleaners) {
    return { success: false, error: "This job is already fully staffed" };
  }

  try {
    // Atomic compare-and-set: the same guards live in the WHERE clause, so a
    // concurrent claim / cancellation / delete can't slip between the checks
    // above and the write. No match → P2025 → we report it as unavailable.
    await db.job.update({
      where: {
        id: jobId,
        deletedAt: null,
        status: { in: ["CREATED", "SCHEDULED"] },
        cleaners: { none: { id: userId } },
        OR: [{ employeeId: null }, { employeeId: { not: userId } }],
        // In the WHERE clause too, so an admin sending a quote back for review
        // between the read above and this write loses the race rather than the
        // cleaner claiming an unpriced job. Same reasoning as the status guard.
        AND: [quoteSettledFilter()],
      },
      data: { cleaners: { connect: { id: userId } } },
    });
  } catch (e) {
    console.error("claimJob update", e);
    return { success: false, error: "This job is no longer available" };
  }

  // Capacity is a relation count, which can't be expressed in the WHERE guard
  // above — so verify after the fact and back out if we overflowed the roster.
  // Failing closed (releasing the spot) beats silently over-staffing a job.
  const after = await db.job.findUnique({
    where: { id: jobId },
    select: { requiredCleaners: true, cleaners: { select: { id: true } } },
  });
  if (after && after.cleaners.length > after.requiredCleaners) {
    await db.job
      .update({
        where: { id: jobId },
        data: { cleaners: { disconnect: { id: userId } } },
      })
      .catch((e) => console.error("claimJob rollback", e));
    return { success: false, error: "This job is already fully staffed" };
  }

  await db.jobLog.create({
    data: {
      jobId,
      userId,
      action: "UPDATED",
      field: "cleaners",
      description: `${session.user.name} claimed this job`,
    },
  });

  revalidatePath("/cleaners/available-jobs");
  revalidatePath("/cleaners/my-jobs");
  revalidatePath("/cleaners/calendar");
  revalidatePath("/cleaners/dashboard");
  return { success: true };
}
