"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Cleaner responds to a job-assignment invite from /my-jobs.
 *  - ACCEPT  → invite marked ACCEPTED; cleaner stays on the job.
 *  - DECLINE → invite marked DECLINED; cleaner removed from the job's
 *              cleaners list; the job goes back to the unassigned folder
 *              if no other cleaner remains.
 */
export async function respondToJobInvite(input: {
  inviteId: string;
  decision: "ACCEPT" | "DECLINE";
  reason?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const invite = await db.jobAssignmentInvite.findUnique({
    where: { id: input.inviteId },
    include: {
      job: { select: { id: true, jobNumber: true } },
    },
  });
  if (!invite) return { success: false, error: "Invite not found" };
  if (invite.cleanerId !== session.user.id) {
    return { success: false, error: "Not your invite" };
  }
  if (invite.decision !== "PENDING") {
    return { success: false, error: `Already ${invite.decision.toLowerCase()}` };
  }
  if (invite.expiresAt < new Date()) {
    await db.jobAssignmentInvite.update({
      where: { id: invite.id },
      data: { decision: "EXPIRED", respondedAt: new Date() },
    });
    return { success: false, error: "Invite expired" };
  }

  const now = new Date();

  if (input.decision === "ACCEPT") {
    // Was this a last-minute broadcast? If so, the cleaner is being
    // newly attached to the job (the invite was created for a pool of
    // available cleaners, not a pre-assigned individual). We connect
    // them to job.cleaners and invalidate every other pending last-
    // minute invite on the same job — first claim wins.
    if (invite.isLastMinute) {
      await db.$transaction([
        db.jobAssignmentInvite.update({
          where: { id: invite.id },
          data: { decision: "ACCEPTED", respondedAt: now },
        }),
        db.job.update({
          where: { id: invite.jobId },
          data: { cleaners: { connect: { id: session.user.id } } },
        }),
        // Per-cleaner assignment status row (item 9).
        db.jobAssignment.upsert({
          where: {
            jobId_cleanerId: {
              jobId: invite.jobId,
              cleanerId: session.user.id,
            },
          },
          update: { status: "ASSIGNED" },
          create: {
            jobId: invite.jobId,
            cleanerId: session.user.id,
            status: "ASSIGNED",
          },
        }),
        db.jobAssignmentInvite.updateMany({
          where: {
            jobId: invite.jobId,
            decision: "PENDING",
            isLastMinute: true,
            NOT: { id: invite.id },
          },
          data: { decision: "EXPIRED", respondedAt: now },
        }),
        db.jobLog.create({
          data: {
            jobId: invite.jobId,
            userId: session.user.id,
            action: "NOTE_ADDED",
            description: `LAST-MINUTE CLAIM: ${session.user.name ?? "Cleaner"} claimed this booking. $${invite.bonusUsd.toFixed(2)} claim bonus to be added at payout.`,
          },
        }),
      ]);
    } else {
      // Standard pre-assigned invite: cleaner is already on job.cleaners.
      await db.$transaction([
        db.jobAssignmentInvite.update({
          where: { id: invite.id },
          data: { decision: "ACCEPTED", respondedAt: now },
        }),
        db.jobLog.create({
          data: {
            jobId: invite.jobId,
            userId: session.user.id,
            action: "NOTE_ADDED",
            description: `${session.user.name ?? "Cleaner"} accepted the assignment.`,
          },
        }),
      ]);
    }
  } else {
    // Decline: remove the cleaner from the job and log it.
    await db.$transaction([
      db.jobAssignmentInvite.update({
        where: { id: invite.id },
        data: {
          decision: "DECLINED",
          respondedAt: now,
          declineReason: input.reason?.trim() || null,
        },
      }),
      db.job.update({
        where: { id: invite.jobId },
        data: {
          cleaners: { disconnect: { id: session.user.id } },
        },
      }),
      // Drop the per-cleaner assignment row for the declined cleaner
      // (keep CANCELLED history rows, matching syncJobAssignments).
      db.jobAssignment.deleteMany({
        where: {
          jobId: invite.jobId,
          cleanerId: session.user.id,
          status: { not: "CANCELLED" },
        },
      }),
      db.jobLog.create({
        data: {
          jobId: invite.jobId,
          userId: session.user.id,
          action: "NOTE_ADDED",
          description: input.reason?.trim()
            ? `${session.user.name ?? "Cleaner"} declined: ${input.reason.trim()}`
            : `${session.user.name ?? "Cleaner"} declined the assignment.`,
        },
      }),
    ]);
  }

  revalidatePath("/cleaners/my-jobs");
  revalidatePath(`/admin/jobs/${invite.jobId}`);
  return { success: true };
}
