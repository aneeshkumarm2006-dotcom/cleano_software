// Claiming an open job: the rules the web's claimJob action has always
// applied, moved here so the phone's POST /api/v1/jobs/available/:id/claim
// runs the same code (API_V1.md §5; the spec is packages/api/src/v1/available.ts).
// The action (app/cleaners/available-jobs/claimJob.ts) is now a thin adapter
// and answers with the same messages as before.
//
// What changed in the move, and only this:
//   - ONE transaction. The job row is locked (SELECT … FOR UPDATE) before any
//     rule is checked, so two cleaners racing for the last spot are
//     serialised: the second one re-reads the crew after the first has
//     committed and is refused FULLY_STAFFED. The web used a compare-and-set
//     update, then a separate capacity re-check and rollback, then the lead,
//     the assignment row and the log as further separate writes; a crash
//     between them could leave a claim half-recorded, and the rollback window
//     let a third reader see an over-full crew. The compare-and-set WHERE is
//     kept inside the transaction as a second line of defence.
//   - the lead, the JobAssignment row and the job log are written in that same
//     transaction, so a claim is recorded whole or not at all. They used to be
//     best-effort; a failure now rolls the claim back and the cleaner is told
//     it failed, rather than holding half a claim.
//   - "now" is an input.
//   - the office's "grabbed" notice is an effect, fired after the commit (and,
//     on the phone, never for a replayed request).
//   - each refusal carries a stable code (packages/api CLAIM_REFUSALS).
import "server-only";

import { isOnHold } from "@bookmops/core/jobs";
import { CATEGORY_BLOCKED_MESSAGE, isCategoryAllowed } from "@bookmops/core/services";
import { Prisma } from "@prisma/client";

import { openForClaimFilter, quoteSettledFilter } from "@/lib/cleaner-jobs";
import { CrossTenantError } from "@/lib/db-scoped";
import { sendAdminUnassignedEvent } from "@/lib/email";
import { requireOrgId } from "@/lib/org";
import { db } from "@/lib/org-db";
import { isAwaitingQuote } from "@/lib/quote-status";
import { isStaffRole } from "@/lib/role-routing";

import type { Actor } from "../actor";
import { effect } from "../effects";
import { failure, ok, type Failure, type Result } from "../result";

export interface ClaimInput {
  jobId: string;
  /** The time the claim is judged at: "has it started?" */
  now: Date;
}

export interface ClaimValue {
  jobId: string;
}

const refuse = (code: string, message: string): Failure => failure(409, code, message);

/** A thrown refusal, so a check inside the transaction rolls it back. */
class ClaimRefused extends Error {
  constructor(readonly result: Failure) {
    super(result.code);
  }
}

export async function claimJobService(actor: Actor, input: ClaimInput): Promise<Result<ClaimValue>> {
  const { jobId, now } = input;
  const userId = actor.userId;

  // Staff only, whatever front door this came through: never a CLIENT, never
  // an APPLICANT, never a missing role (API_V1.md §10).
  if (!isStaffRole(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64) {
    return failure(404, "NOT_FOUND", "Job not found");
  }

  const organizationId = await requireOrgId();

  let notice: { jobNumber: number; clientName: string; startTime: Date };
  try {
    notice = await db.$transaction(async (tx) => {
      // Serialise every claim on this job. The row lock is held to the commit,
      // and every read below it sees what the claim before it committed.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Job"
        WHERE id = ${jobId} AND "organizationId" = ${organizationId}
        FOR UPDATE`;
      if (locked.length === 0) throw new ClaimRefused(failure(404, "NOT_FOUND", "Job not found"));

      const job = await tx.job.findFirst({
        where: { id: jobId },
        select: {
          id: true,
          deletedAt: true,
          status: true,
          startTime: true,
          // Both only so the admin's notice can name the job (Sept 10, item 4).
          jobNumber: true,
          clientName: true,
          employeeId: true,
          requiredCleaners: true,
          jobType: true,
          // Stage 11 / PDF #9 — an unsettled quote is not claimable work.
          quoteStatus: true,
          // Round 4, fix 6 — a hold that says WHY it is held is not claimable
          // work either. Selected because the guard below reads it.
          holdReason: true,
          cleaners: { select: { id: true } },
        },
      });
      // Fail closed: a soft-deleted job doesn't exist as far as a cleaner is concerned.
      if (!job || job.deletedAt) throw new ClaimRefused(failure(404, "NOT_FOUND", "Job not found"));

      // Already ON the job — as an assigned cleaner OR as the job's LEAD.
      if (job.employeeId === userId) {
        throw new ClaimRefused(refuse("ALREADY_CLAIMED", "You're already assigned to this job"));
      }
      if (job.cleaners.some((c) => c.id === userId)) {
        throw new ClaimRefused(refuse("ALREADY_CLAIMED", "You already claimed this job"));
      }

      const me = await tx.user.findFirst({
        where: { id: userId },
        select: { cleanerTier: true, allowedServiceCategories: true },
      });

      // Service category permission (awerfixes.pdf item 3). The board hides
      // these jobs, but the board is a filtered list and this is the write.
      if (!isCategoryAllowed(job.jobType, me?.allowedServiceCategories)) {
        throw new ClaimRefused(refuse("CATEGORY_NOT_ALLOWED", CATEGORY_BLOCKED_MESSAGE));
      }

      // Spec item 12: trainees can't claim solo work — only jobs that already
      // have a Field Lead or approved cleaner on the crew.
      if (me?.cleanerTier === "TRAINEE") {
        const crewIds = [...job.cleaners.map((c) => c.id), ...(job.employeeId ? [job.employeeId] : [])];
        const approvedOnCrew = crewIds.length
          ? await tx.user.count({ where: { id: { in: crewIds }, cleanerTier: { not: "TRAINEE" } } })
          : 0;
        if (approvedOnCrew === 0) {
          throw new ClaimRefused(
            refuse(
              "TRAINEE_NEEDS_CREW",
              "Trainees can't claim solo jobs — this job needs a Field Lead or approved cleaner first.",
            ),
          );
        }
      }

      // Only genuinely open work is claimable — mirrors claimableJobsWhere().
      if (job.status !== "CREATED" && job.status !== "SCHEDULED") {
        throw new ClaimRefused(refuse("NOT_AVAILABLE", "This job is no longer available"));
      }
      // Round 4, fix 6 — an EXPLAINED hold is not open work. A `CREATED` row
      // with no reason is a legacy default rather than a hold and stays
      // claimable; see `openForClaimFilter`.
      if (isOnHold(job) && job.holdReason !== null) {
        throw new ClaimRefused(refuse("ON_HOLD", "This job is on hold and can't be claimed yet"));
      }
      // An unaccepted post-construction quote is unpriced, unconfirmed work.
      if (isAwaitingQuote(job.quoteStatus)) {
        throw new ClaimRefused(refuse("NOT_AVAILABLE", "This job is no longer available"));
      }
      if (job.startTime.getTime() < now.getTime()) {
        throw new ClaimRefused(refuse("ALREADY_STARTED", "This job has already started"));
      }
      // Under the row lock, so this count is the committed crew: two cleaners
      // can't both take the last spot.
      if (job.cleaners.length >= job.requiredCleaners) {
        throw new ClaimRefused(refuse("FULLY_STAFFED", "This job is already fully staffed"));
      }

      // The compare-and-set, kept as a second line of defence: the same guards
      // in the WHERE, so a write that somehow raced the checks above matches
      // nothing and the whole claim rolls back.
      // No match → the scoped client's ownership check refuses the write
      // (CrossTenantError), or Prisma's P2025 → "no longer available", below.
      await tx.job.update({
        where: {
          id: jobId,
          deletedAt: null,
          cleaners: { none: { id: userId } },
          OR: [{ employeeId: null }, { employeeId: { not: userId } }],
          AND: [quoteSettledFilter(), openForClaimFilter()],
        },
        data: { cleaners: { connect: { id: userId } } },
      });

      // Round 4, fix 2 — the three places an assignment is recorded move
      // together: the cleaners M2M (above), the lead slot if it is empty, and
      // the per-cleaner JobAssignment row. `employeeId: null` in the WHERE is a
      // compare-and-set, so an existing lead is never displaced.
      await tx.job.updateMany({
        where: { id: jobId, employeeId: null },
        data: { employeeId: userId },
      });
      await tx.jobAssignment.upsert({
        where: { jobId_cleanerId: { jobId, cleanerId: userId } },
        // An existing row keeps whatever live status it already reached.
        update: {},
        create: { jobId, cleanerId: userId, status: "ASSIGNED" },
      });

      await tx.jobLog.create({
        data: {
          jobId,
          userId,
          action: "UPDATED",
          field: "cleaners",
          description: `${actor.name} claimed this job`,
        },
      });

      return { jobNumber: job.jobNumber, clientName: job.clientName, startTime: job.startTime };
    });
  } catch (e) {
    if (e instanceof ClaimRefused) return e.result;
    // The guarded write matched nothing (the job changed under the checks),
    // or lost a race at the database: the answer the web always gave.
    if (
      e instanceof CrossTenantError ||
      (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2025" || e.code === "P2002"))
    ) {
      console.error("claimJob write", e instanceof CrossTenantError ? "guard" : e.code);
      return refuse("NOT_AVAILABLE", "This job is no longer available");
    }
    throw e;
  }

  // The office has to hear that the board emptied (Sept 10, item 4). After the
  // commit: a notice that fails must never tell a cleaner they missed a job
  // they now hold.
  return ok({ jobId }, [
    effect("claimJob.admin-notice", () =>
      sendAdminUnassignedEvent({
        event: "grabbed",
        jobId,
        jobNumber: notice.jobNumber,
        clientName: notice.clientName,
        startTime: notice.startTime.toISOString(),
      }),
    ),
  ]);
}
