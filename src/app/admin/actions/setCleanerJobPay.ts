"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Manual per-cleaner pay override for one job (JobAssignment.payAmount).
 *
 * FLAT/HOURLY jobs pay a TEAM TOTAL that is split between the assigned cleaners.
 * This lets an admin split it unevenly — e.g. a $100 job paid $70 / $30 instead
 * of $50 / $50. Cleaners with no override split whatever is left of the total,
 * so the crew can never be paid more than the agreed amount.
 *
 * Passing `amount: null` clears the override and returns that cleaner to the
 * normal rule (even split for FLAT/HOURLY, tier split for PERCENTAGE).
 *
 * AUTHZ: OWNER/ADMIN only.
 */
export async function setCleanerJobPay(input: {
  jobId: string;
  cleanerId: string;
  amount: number | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const { jobId, cleanerId } = input;
  if (typeof jobId !== "string" || !jobId) {
    return { success: false, error: "Invalid request" };
  }
  if (typeof cleanerId !== "string" || !cleanerId) {
    return { success: false, error: "Invalid request" };
  }

  let amount: number | null = null;
  if (input.amount !== null && input.amount !== undefined) {
    const n = Number(input.amount);
    if (!Number.isFinite(n) || n < 0 || n > 100_000) {
      return { success: false, error: "Enter a valid amount" };
    }
    amount = Math.round(n * 100) / 100;
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        employeeId: true,
        cleaners: { select: { id: true } },
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    // The cleaner must actually be on this job.
    const onJob =
      job.employeeId === cleanerId ||
      job.cleaners.some((c) => c.id === cleanerId);
    if (!onJob) {
      return { success: false, error: "That cleaner is not on this job" };
    }

    await db.jobAssignment.upsert({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      update: { payAmount: amount },
      create: { jobId, cleanerId, payAmount: amount },
    });

    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "UPDATED",
        field: "cleanerPay",
        newValue: amount === null ? "cleared" : String(amount),
        description:
          amount === null
            ? `Cleared the manual pay override for a cleaner (back to the standard split)`
            : `Set a cleaner's pay for this job to $${amount.toFixed(2)}`,
      },
    });

    revalidatePath(`/admin/jobs/${jobId}`);
    return { success: true };
  } catch (e) {
    console.error("setCleanerJobPay", e);
    return { success: false, error: "Could not update the pay" };
  }
}
