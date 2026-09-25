"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Removing somebody from the team without removing them from the record.
 *
 * This used to refuse outright — "Cannot delete employee with existing jobs" —
 * which left an admin two bad options: hand-reassign every job the person was
 * ever on, or leave a departed cleaner sitting on next week's schedule. In
 * practice they left them, and the jobs stayed assigned to somebody who was
 * never coming.
 *
 * The rule now follows the work, not the person (Aug 31 list, item 13):
 *
 *   FUTURE jobs are released. Work that has not happened cannot be done by
 *   somebody who has left, so the assignment comes off all three places it is
 *   recorded and the job returns to the pool for reassignment.
 *
 *   PAST jobs keep them. Those are payroll, history and reporting — a finished
 *   job that forgets who cleaned it is a hole in the books. So a person with
 *   history is ARCHIVED (deletedAt) rather than erased, which keeps every
 *   completed job's link intact.
 *
 * Only somebody who never worked a job is deleted outright, which is what this
 * action always did for that case.
 */

/** Statuses that mean the work is settled and must keep its cleaner. */
const FINISHED = ["COMPLETED", "PAID", "CANCELLED"] as const;

/** Jobs this person is on that have NOT happened yet. */
function futureJobsWhere(employeeId: string) {
  return {
    deletedAt: null,
    startTime: { gt: new Date() },
    status: { notIn: [...FINISHED] },
    OR: [{ employeeId }, { cleaners: { some: { id: employeeId } } }],
  };
}

export interface EmployeeDeletionPreview {
  /** Upcoming jobs that will be released back to the pool. */
  futureJobs: number;
  /** Finished jobs that will keep this person attached. */
  pastJobs: number;
  /** True when the record is archived rather than erased. */
  willArchive: boolean;
}

/**
 * What deleting this person would do, so the admin is told BEFORE they confirm
 * rather than after (item 13: "show how many future jobs will be affected").
 */
export async function previewEmployeeDeletion(
  employeeId: string
): Promise<EmployeeDeletionPreview | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const actorRole = (session?.user as { role?: string } | undefined)?.role;
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") return null;

  /**
   * Two plain counts and a subtraction, rather than a second count wrapped in
   * `NOT: futureJobsWhere(...)`.
   *
   * For LEGIBILITY, not speed — benchmarked against the NOT form and they are
   * the same, ~550ms each on the staging pooler. A confirm dialog was measured
   * taking 15s to fill in, which is what prompted the look; that time is
   * `next dev` talking to a remote database, where trivial endpoints in the
   * same session took 11-16s too. Nothing here was the cause, and rewriting it
   * for performance would have been a fix for a problem that did not exist.
   * "Everything they are on, minus the future ones" is simply easier to read
   * than a negated predicate.
   */
  const onThisPerson = {
    deletedAt: null,
    OR: [{ employeeId }, { cleaners: { some: { id: employeeId } } }],
  };
  const [futureJobs, allJobs] = await Promise.all([
    db.job.count({ where: futureJobsWhere(employeeId) }),
    db.job.count({ where: onThisPerson }),
  ]);
  const pastJobs = Math.max(0, allJobs - futureJobs);

  return { futureJobs, pastJobs, willArchive: pastJobs > 0 };
}

export async function deleteEmployee(employeeId: string): Promise<{
  success: boolean;
  error?: string;
  /** What actually happened, so the caller can say so. */
  released?: number;
  archived?: boolean;
}> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const actorRole = (session?.user as { role?: string } | undefined)?.role;
    if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
      return { success: false, error: "Not authorized." };
    }

    const employee = await db.user.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true },
    });
    if (!employee) {
      return { success: false, error: "Employee not found." };
    }
    if (employeeId === session?.user?.id) {
      return { success: false, error: "You cannot delete your own account." };
    }

    // Commission rows are money owed to this person, so `Commission.salesRepId`
    // is ON DELETE RESTRICT rather than the cascade most User relations use
    // (Stage 11.2). Without this check the delete would fail down in Postgres
    // and surface as the generic "Failed to delete employee", which tells the
    // admin nothing about what is actually holding the record.
    const commissionCount = await db.commission.count({
      where: { salesRepId: employeeId },
    });
    if (commissionCount > 0) {
      return {
        success: false,
        error: `Cannot delete: this person has ${commissionCount} commission record${commissionCount === 1 ? "" : "s"} under Sales → Commissions. Delete those first.`,
      };
    }

    const futureJobs = await db.job.findMany({
      where: futureJobsWhere(employeeId),
      // `employeeId` comes along so the loop below knows whether this person is
      // the job's LEAD without asking again per job.
      select: { id: true, employeeId: true },
    });
    // Same subtraction as the preview, and for the same reason: it reads
    // better, not faster.
    const allJobCount = await db.job.count({
      where: {
        deletedAt: null,
        OR: [{ employeeId }, { cleaners: { some: { id: employeeId } } }],
      },
    });
    const pastJobCount = Math.max(0, allJobCount - futureJobs.length);

    await db.$transaction(async (tx) => {
      // All three places an assignment is recorded, together — the same trio
      // claimJob writes. Clearing one and not the others is how a job ends up
      // half-assigned to somebody who has left.
      for (const job of futureJobs) {
        await tx.job.update({
          where: { id: job.id },
          data: {
            cleaners: { disconnect: { id: employeeId } },
            // Only clear the lead when it is actually this person — a job whose
            // lead is somebody else must keep them.
            ...(job.employeeId === employeeId ? { employeeId: null } : {}),
          },
        });
      }
      await tx.jobAssignment.deleteMany({
        where: { cleanerId: employeeId, jobId: { in: futureJobs.map((j) => j.id) } },
      });
      // Pending invitations to work are assignments that have not happened yet.
      await tx.jobAssignmentInvite.deleteMany({
        where: { cleanerId: employeeId, jobId: { in: futureJobs.map((j) => j.id) } },
      });

      if (pastJobCount > 0) {
        // Archived, not erased: every finished job keeps the person who worked
        // it. `isActive: false` is what locks them out of the app.
        await tx.user.update({
          where: { id: employeeId },
          data: { deletedAt: new Date(), isActive: false },
        });
      } else {
        await tx.account.deleteMany({ where: { userId: employeeId } });
        await tx.user.delete({ where: { id: employeeId } });
      }
    });

    revalidatePath("/admin/employees");
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/calendar");

    return { success: true, released: futureJobs.length, archived: pastJobCount > 0 };
  } catch (error) {
    console.error("Error deleting employee:", error);
    return {
      success: false,
      error: "Failed to delete employee. Please try again.",
    };
  }
}
