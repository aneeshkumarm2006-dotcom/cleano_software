"use server";

// One cleaner's $/hr on one job.
//
// Sept 17 list, item 22: "job modal only has one shared Cleaner hourly rate
// field, which does not work properly for jobs with 2+ cleaners." A trainee and
// a field lead on the same hourly job were paid the same rate, so the admin
// either underpaid one or overpaid the other, and the only way out was to drop
// hourly pay and type manual amounts instead.
//
// Deliberately a SIBLING of `setCleanerJobPay` rather than part of it. They are
// different things and an admin has to be able to tell them apart: a per-cleaner
// AMOUNT is a figure that beats the clock entirely, while a per-cleaner RATE is
// multiplied by what the clock recorded. Folding them into one control would
// make "$25" ambiguous on the one screen where it must not be.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/org-db";
import { snapshotHourlyEmployeePay } from "@/lib/hourly-pay.server";

/** Above this an admin has typed a total into a rate field. */
const MAX_HOURLY_RATE = 1000;

export async function setCleanerHourlyRate(input: {
  jobId: string;
  cleanerId: string;
  rate: number | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const { jobId, cleanerId } = input;
  if (typeof jobId !== "string" || !jobId || typeof cleanerId !== "string" || !cleanerId) {
    return { success: false, error: "Invalid request" };
  }

  let rate: number | null = null;
  if (input.rate !== null && input.rate !== undefined) {
    const n = Number(input.rate);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_HOURLY_RATE) {
      return {
        success: false,
        error: `Enter an hourly rate between $0.01 and $${MAX_HOURLY_RATE}.`,
      };
    }
    rate = Math.round(n * 100) / 100;
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { id: true, payType: true, hourlyRate: true },
    });
    if (!job) return { success: false, error: "Job not found" };
    if (job.payType !== "HOURLY") {
      return {
        success: false,
        error: "This job isn't paid hourly, so a per-cleaner rate has nothing to multiply.",
      };
    }
    // Clearing the only rate the job has would leave the crew on nothing. The
    // pay math reads that as "the stored team total stands", which is a quiet
    // freeze rather than an error, so it is refused here where it can be said.
    if (rate === null && !(job.hourlyRate && job.hourlyRate > 0)) {
      return {
        success: false,
        error:
          "This job has no crew-wide hourly rate to fall back on. Set one on the job first, or give this cleaner a rate.",
      };
    }

    // Must exist before it can carry a rate: a cleaner with no assignment row
    // is not on this job.
    const assignment = await db.jobAssignment.findUnique({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      select: { id: true, status: true, hourlyRate: true },
    });
    if (!assignment) {
      return { success: false, error: "That cleaner isn't assigned to this job." };
    }
    if (assignment.status === "CANCELLED") {
      return {
        success: false,
        error: "That cleaner has come off this job. Their old rate is history, not a rate to change.",
      };
    }

    await db.jobAssignment.update({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      data: { hourlyRate: rate },
    });

    await db.jobLog
      .create({
        data: {
          jobId,
          userId: session.user.id,
          action: "UPDATED",
          field: "cleanerHourlyRate",
          oldValue: assignment.hourlyRate == null ? "job rate" : String(assignment.hourlyRate),
          newValue: rate === null ? "job rate" : String(rate),
          description:
            rate === null
              ? "Cleared a cleaner's own hourly rate — they go back to the job's rate."
              : `Set a cleaner's hourly rate on this job to $${rate.toFixed(2)}/h.`,
        },
      })
      .catch(() => {});

    // The team total is the SUM of per-cleaner hours × their own rate, so
    // changing one cleaner's rate changes the job's employee pay. Re-snapshot
    // rather than leaving the stored figure to disagree with the rows under
    // it; a no-op when the job was never clocked.
    await snapshotHourlyEmployeePay(jobId).catch(() => {});

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/payouts");
    return { success: true };
  } catch (e) {
    console.error("setCleanerHourlyRate", e);
    return { success: false, error: "Couldn't save that rate. Nothing was changed." };
  }
}
