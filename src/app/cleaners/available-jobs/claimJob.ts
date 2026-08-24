"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  isCategoryAllowed,
  CATEGORY_BLOCKED_MESSAGE,
} from "@/lib/service-permissions";
import { openForClaimFilter, quoteSettledFilter } from "@/lib/cleaner-jobs";
import { isAwaitingQuote } from "@/lib/quote-status";
import { isOnHold } from "@/lib/job-hold";

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
      // Round 4, fix 6 — a hold that says WHY it is held is not claimable work
      // either. Selected because the guard below reads it; without the column
      // the check would be `undefined` and quietly pass everything.
      holdReason: true,
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
  // Round 4, fix 6 — and an EXPLAINED hold is not open work. The board filters
  // these out (`openForClaimFilter`), but this action takes a jobId from the
  // client, so the rule has to exist here too or the filter is decorative —
  // exactly the reasoning the quote guard below is written on. A `CREATED` row
  // with no reason is a legacy default rather than a hold and stays claimable;
  // see `openForClaimFilter` for why that distinction is the one being made.
  if (isOnHold(job) && job.holdReason !== null) {
    return { success: false, error: "This job is on hold and can't be claimed yet" };
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
        cleaners: { none: { id: userId } },
        OR: [{ employeeId: null }, { employeeId: { not: userId } }],
        // In the WHERE clause too, so an admin sending a quote back for review
        // — or putting the job ON HOLD (round 4, fix 6) — between the read
        // above and this write loses the race rather than the cleaner claiming
        // unpriced or parked work. `openForClaimFilter` carries the status test
        // that used to sit on its own line here, so the board, the guard above
        // and this race window can never disagree about what "open" means.
        AND: [quoteSettledFilter(), openForClaimFilter()],
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

  // Round 4, fix 2 — the three places an assignment is recorded must move
  // together. This action wrote ONLY the `cleaners` M2M row, so a claimed job
  // came out half-assigned: no lead, and no per-cleaner `JobAssignment` row.
  //
  // The M2M alone is enough for the job to reach the cleaner's own list
  // (`cleanerAssignedWhere` reads `employeeId OR cleaners`), which is why this
  // never showed up as a missing job — but the admin's employee profile reads
  // the `employeeId` relation, `JobAssignment` carries the per-cleaner status
  // and pay override, and the PDF asks for all four surfaces to read the same
  // assignment data. Half a record is how they drift apart.
  //
  // Both writes run only after the capacity check above has held, so a claim
  // that gets rolled back never leaves a lead or an assignment row behind.
  //
  // `updateMany` with `employeeId: null` in the WHERE is a compare-and-set: two
  // cleaners claiming the same open job concurrently can't both become the
  // lead, and an existing lead is never displaced. Same shape bulkAssignCleaner
  // uses. Best-effort on both — the claim itself already succeeded, and failing
  // it now would tell the cleaner they didn't get a job they did.
  await db.job
    .updateMany({
      where: { id: jobId, employeeId: null },
      data: { employeeId: userId },
    })
    .catch((e) => console.error("claimJob lead", e));

  await db.jobAssignment
    .upsert({
      where: { jobId_cleanerId: { jobId, cleanerId: userId } },
      // An existing row keeps whatever live status it already reached.
      update: {},
      create: { jobId, cleanerId: userId, status: "ASSIGNED" },
    })
    .catch((e) => console.error("claimJob assignment row", e));

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
