"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  alertIfTraineeLeftUnpaired,
  resolveJobLead,
} from "@/lib/job-assignments";

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
      job: {
        select: {
          id: true,
          jobNumber: true,
          status: true,
          deletedAt: true,
          // The lead. Both branches below have to keep it pointing at a real
          // member of the crew — see the notes on each (round 4, fix 2).
          employeeId: true,
          cleaners: { select: { id: true } },
        },
      },
    },
  });
  if (!invite) return { success: false, error: "Invite not found" };
  if (invite.cleanerId !== session.user.id) {
    return { success: false, error: "Not your invite" };
  }
  // The booking has to still be open for the answer to mean anything. The
  // invite list on /my-jobs already refuses to show these (page.tsx: "Closed /
  // archived jobs never ask for an answer"), but the panel it renders is a
  // snapshot — archive a job and the buttons stay live on any page loaded
  // beforehand. That is how job #1545 was archived at 23:49 and accepted at
  // 23:53, putting cancelled work on a cleaner's schedule. This mirrors that
  // query's condition on the server, where it is actually enforceable.
  //
  // Declining is refused too: it disconnects the cleaner from the job, and
  // archiving deliberately keeps the team attached so a restore brings them
  // back with it (deleteJob.ts).
  if (invite.job.deletedAt || invite.job.status === "CANCELLED") {
    return { success: false, error: "This booking is no longer active." };
  }
  if (invite.job.status === "COMPLETED" || invite.job.status === "PAID") {
    return { success: false, error: "This booking is already closed." };
  }
  // A DIRECT assignment invite that ran out of time is still answerable: the
  // cleaner stays on the job when the invite expires (new fix list item 2), so
  // a late tap just records the confirmation they always could have given. A
  // LAST-MINUTE broadcast is different — it's a race for an open job, and an
  // expired one may already be someone else's.
  const isExpired =
    invite.decision === "EXPIRED" || invite.expiresAt < new Date();
  const answerable =
    invite.decision === "PENDING" || (invite.decision === "EXPIRED" && !invite.isLastMinute);

  if (!answerable) {
    return { success: false, error: `Already ${invite.decision.toLowerCase()}` };
  }
  if (isExpired && invite.isLastMinute) {
    if (invite.decision === "PENDING") {
      await db.jobAssignmentInvite.update({
        where: { id: invite.id },
        data: { decision: "EXPIRED", respondedAt: new Date() },
      });
    }
    return { success: false, error: "Invite expired" };
  }
  // Invites expired by the OLD sweep detached the cleaner at the same time.
  // Answering one of those would confirm a job they're no longer on, so a late
  // answer only stands while the assignment does.
  if (
    isExpired &&
    !invite.isLastMinute &&
    !invite.job.cleaners.some((c) => c.id === session.user.id)
  ) {
    return {
      success: false,
      error: "You're no longer assigned to this job — ask an admin to reassign it.",
    };
  }

  const now = new Date();

  if (input.decision === "ACCEPT") {
    // Spec item 12: a trainee can't accept a last-minute broadcast onto a job
    // with no Field Lead / approved cleaner — that would put them solo.
    if (invite.isLastMinute) {
      const me = await db.user.findUnique({
        where: { id: session.user.id },
        select: { cleanerTier: true },
      });
      if (me?.cleanerTier === "TRAINEE") {
        const job = await db.job.findUnique({
          where: { id: invite.jobId },
          select: { employeeId: true, cleaners: { select: { id: true } } },
        });
        const crewIds = [
          ...(job?.cleaners.map((c) => c.id) ?? []),
          ...(job?.employeeId ? [job.employeeId] : []),
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
              "Trainees can't take solo jobs — this booking needs a Field Lead or approved cleaner first.",
          };
        }
      }
    }

    // Was this a last-minute broadcast? If so, the cleaner is being
    // newly attached to the job (the invite was created for a pool of
    // available cleaners, not a pre-assigned individual). We connect
    // them to job.cleaners and invalidate every other pending last-
    // minute invite on the same job — first claim wins.
    if (invite.isLastMinute) {
      await db.$transaction(async (tx) => {
        await tx.jobAssignmentInvite.update({
          where: { id: invite.id },
          data: { decision: "ACCEPTED", respondedAt: now },
        });
        await tx.job.update({
          where: { id: invite.jobId },
          data: { cleaners: { connect: { id: session.user.id } } },
        });
        // Round 4, fix 2 — a last-minute broadcast attaches a cleaner to a job
        // that by definition had nobody on it, so if the lead slot is still
        // empty this cleaner fills it. Written as a compare-and-set on
        // `employeeId: null` (rather than reading the value above and writing it
        // back) so two cleaners racing the same broadcast can't both claim the
        // lead, and an existing lead is never displaced.
        await tx.job.updateMany({
          where: { id: invite.jobId, employeeId: null },
          data: { employeeId: session.user.id },
        });
        // Per-cleaner assignment status row (item 9).
        await tx.jobAssignment.upsert({
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
        });
        await tx.jobAssignmentInvite.updateMany({
          where: {
            jobId: invite.jobId,
            decision: "PENDING",
            isLastMinute: true,
            NOT: { id: invite.id },
          },
          data: { decision: "EXPIRED", respondedAt: now },
        });
        await tx.jobLog.create({
          data: {
            jobId: invite.jobId,
            userId: session.user.id,
            action: "NOTE_ADDED",
            description: `LAST-MINUTE CLAIM: ${session.user.name ?? "Cleaner"} claimed this booking. $${invite.bonusUsd.toFixed(2)} claim bonus to be added at payout.`,
          },
        });
      });
    } else {
      // Standard pre-assigned invite: cleaner is already on job.cleaners.
      await db.$transaction(async (tx) => {
        await tx.jobAssignmentInvite.update({
          where: { id: invite.id },
          data: { decision: "ACCEPTED", respondedAt: now },
        });
        await tx.jobLog.create({
          data: {
            jobId: invite.jobId,
            userId: session.user.id,
            action: "NOTE_ADDED",
            description: `${session.user.name ?? "Cleaner"} accepted the assignment.`,
          },
        });
      });
    }
  } else {
    // Decline: remove the cleaner from the job and log it.
    //
    // Round 4, fix 2 — the lead has to come off with them. `employeeId` is the
    // OTHER half of "who is on this job" (`cleanerAssignedWhere` matches either
    // one), so disconnecting the M2M row alone left a declined job sitting on
    // the decliner's own schedule, and the admin's employee profile — which
    // reads the lead relation — still showing them on it. Whoever is left on
    // the crew takes over; an empty crew clears the column.
    //
    // Only when the decliner IS the lead. A job whose lead is someone outside
    // the M2M list (legacy rows predate `resolveJobLead` keeping the two in
    // step) must not have that lead wiped by an unrelated cleaner's decline.
    const declinerIsLead = invite.job.employeeId === session.user.id;
    const nextLead = declinerIsLead
      ? resolveJobLead(
          invite.job.employeeId,
          invite.job.cleaners
            .map((c) => c.id)
            .filter((id) => id !== session.user.id)
        )
      : invite.job.employeeId;

    await db.$transaction(async (tx) => {
      await tx.jobAssignmentInvite.update({
        where: { id: invite.id },
        data: {
          decision: "DECLINED",
          respondedAt: now,
          declineReason: input.reason?.trim() || null,
        },
      });
      await tx.job.update({
        where: { id: invite.jobId },
        data: {
          cleaners: { disconnect: { id: session.user.id } },
          employeeId: nextLead,
        },
      });
      // Drop the per-cleaner assignment row for the declined cleaner
      // (keep CANCELLED history rows, matching syncJobAssignments).
      await tx.jobAssignment.deleteMany({
        where: {
          jobId: invite.jobId,
          cleanerId: session.user.id,
          status: { not: "CANCELLED" },
        },
      });
      await tx.jobLog.create({
        data: {
          jobId: invite.jobId,
          userId: session.user.id,
          action: "NOTE_ADDED",
          description: input.reason?.trim()
            ? `${session.user.name ?? "Cleaner"} declined: ${input.reason.trim()}`
            : `${session.user.name ?? "Cleaner"} declined the assignment.`,
        },
      });
    });
    // Spec item 12 backstop: declining may have left a trainee solo — alert
    // admins to re-pair.
    await alertIfTraineeLeftUnpaired(invite.jobId);
  }

  revalidatePath("/cleaners/my-jobs");
  revalidatePath(`/admin/jobs/${invite.jobId}`);
  return { success: true };
}
