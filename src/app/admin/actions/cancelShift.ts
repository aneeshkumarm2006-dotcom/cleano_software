"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAssignmentInvites } from "@/lib/invites";
import { sendProviderLastMinuteOpening } from "@/lib/email";
import { LAST_MINUTE_CLAIM_BONUS_USD } from "@/lib/policy";
import { applyStrike } from "@/lib/strikes";
import {
  alertIfTraineeLeftUnpaired,
  resolveJobLead,
} from "@/lib/job-assignments";

const LATE_CANCEL_HOURS = 24;
/** Inside this window the cleaner cancel triggers the last-minute repost. */
const LAST_MINUTE_HOURS = 24;

export async function cancelShift(jobId: string): Promise<{ success: true; penaltyApplied: boolean } | { success: false; error: string }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const employeeId = session.user.id;

    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobNumber: true,
        startTime: true,
        status: true,
        employeeId: true,
        cleaners: { select: { id: true } },
      },
    });

    if (!job) return { success: false, error: "Job not found" };

    const isAssigned =
      job.employeeId === employeeId ||
      job.cleaners.some((c) => c.id === employeeId);

    if (!isAssigned) return { success: false, error: "Not assigned to this job" };

    if (["COMPLETED", "CANCELLED"].includes(job.status)) {
      return { success: false, error: "Job is already completed or cancelled" };
    }

    const hoursUntilShift = (job.startTime.getTime() - Date.now()) / (1000 * 60 * 60);
    const isLateCancel = hoursUntilShift < LATE_CANCEL_HOURS && hoursUntilShift > 0;

    // Unassign the employee from the job — from BOTH halves of the assignment.
    //
    // Round 4, fix 2. This used to be an if/ELSE: a cleaner who was the LEAD had
    // `employeeId` nulled and was left connected to `cleaners`. Since
    // `resolveJobLead` guarantees the lead is also a member of the crew, that is
    // the normal shape of a modern job — so cancelling a shift as its lead did
    // essentially nothing a cleaner could see. `cleanerAssignedWhere` matches on
    // `employeeId OR cleaners`, so the cancelled shift stayed on their My Jobs
    // list and their calendar, and they still counted as crew.
    //
    // It also broke the last-minute repost below, which only fans out when
    // `cleaners.length === 0` — a count that could never reach zero while the
    // canceller was still connected. The shift went quietly leaderless with
    // nobody invited to cover it.
    //
    // The lead moves to whoever is left (or clears), and only when the canceller
    // held it: a job whose lead sits outside the M2M list (legacy rows predate
    // the two being kept in step) must not lose that lead to someone else's
    // cancellation.
    const remainingCleanerIds = job.cleaners
      .map((c) => c.id)
      .filter((id) => id !== employeeId);
    const nextLead =
      job.employeeId === employeeId
        ? resolveJobLead(job.employeeId, remainingCleanerIds)
        : job.employeeId;

    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: {
          // A no-op when they were only the lead and never in the crew list.
          cleaners: { disconnect: { id: employeeId } },
          employeeId: nextLead,
        },
      });

      // Mark this cleaner's assignment row cancelled (if one exists).
      await tx.jobAssignment.updateMany({
        where: { jobId, cleanerId: employeeId },
        data: { status: "CANCELLED" },
      });

      await tx.jobLog.create({
        data: {
          jobId,
          userId: employeeId,
          action: "NOTE_ADDED",
          description: isLateCancel
            ? `Cleaner cancelled shift < ${LATE_CANCEL_HOURS}h before start — late-cancel penalty applied (1-star rating)`
            : "Cleaner cancelled shift",
        },
      });

      if (isLateCancel) {
        // 1-star penalty rating for the cancelled job (the rating scale floor
        // is 1.0; see RATING_MIN in policy.ts). Feeds the running average like
        // any other rating.
        await tx.employeeRating.create({
          data: {
            employeeId,
            jobId,
            rating: 1.0,
            notes: `penalty:late_cancel (cancelled ${Math.round(hoursUntilShift)}h before shift)`,
            ratedBy: employeeId,
          },
        });
      }
    });

    // Accountability strike for a late cancel (admin can excuse it).
    if (isLateCancel) {
      await applyStrike({
        cleanerId: employeeId,
        reasonCode: "LATE_CANCEL",
        detail: `cancelled job #${job.jobNumber} ${Math.round(hoursUntilShift)}h before start`,
        jobId,
        dedupePerJob: true,
      }).catch((e) => console.error("late-cancel strike", e));
    }

    // Last-minute repost: if the cancellation happened within the
    // last-minute window AND the job no longer has any cleaners assigned,
    // fan out a bonus invite to other EMPLOYEEs.
    if (hoursUntilShift > 0 && hoursUntilShift < LAST_MINUTE_HOURS) {
      const refreshed = await db.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          jobNumber: true,
          clientName: true,
          startTime: true,
          location: true,
          deletedAt: true,
          cleaners: { select: { id: true } },
        },
      });
      // `deletedAt` gates the WHOLE repost, not just the invite call.
      // createAssignmentInvites already returns [] for an archived job, but the
      // email loop below sits outside it and ran regardless — so every EMPLOYEE
      // and FIELD_LEAD was emailed a paid last-minute opening, with a claim
      // bonus, for a booking that had been archived. The invite was unclaimable
      // (the my-jobs listing filters it out and respondToJobInvite refuses it),
      // so the offer could only ever waste their time.
      if (refreshed && !refreshed.deletedAt && refreshed.cleaners.length === 0) {
        const broadcast = (
          await db.user.findMany({
            where: {
              role: { in: ["EMPLOYEE", "FIELD_LEAD"] },
              id: { not: employeeId },
            },
            select: { id: true, name: true, email: true },
          })
        ).filter((u) => !!u.email);

        if (broadcast.length > 0) {
          await createAssignmentInvites({
            jobId,
            cleanerIds: broadcast.map((u) => u.id),
            isLastMinute: true,
            bonusUsd: LAST_MINUTE_CLAIM_BONUS_USD,
          });
          for (const u of broadcast) {
            if (!u.email) continue;
            sendProviderLastMinuteOpening({
              to: u.email,
              providerName: u.name,
              jobId,
              jobNumber: refreshed.jobNumber,
              clientName: refreshed.clientName,
              startTime: refreshed.startTime.toISOString(),
              address: refreshed.location ?? "",
              bonusUsd: LAST_MINUTE_CLAIM_BONUS_USD,
            }).catch((e) => console.error("last-minute opening email", e));
          }
        }
      }
    }

    // Spec item 12 backstop: if this departure left a trainee as the only
    // worker, alert admins to re-pair (the repost above only fires for a fully
    // empty crew).
    await alertIfTraineeLeftUnpaired(jobId);

    revalidatePath("/cleaners/my-jobs");
    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    // Reposts the now-open shift so other cleaners see it in the available pool.
    revalidatePath("/cleaners/available-jobs");
    return { success: true, penaltyApplied: isLateCancel };
  } catch (err) {
    console.error("cancelShift error:", err);
    return { success: false, error: "Failed to cancel shift" };
  }
}
