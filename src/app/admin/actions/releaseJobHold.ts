"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";
import { holdReasonText, isOnHold, ON_HOLD_STATUS } from "@/lib/job-hold";
import { isAwaitingQuote } from "@/lib/quote-status";

/**
 * Take a job off hold: CREATED → SCHEDULED, reason cleared, logged.
 *
 * Round 4, fix 6 (PDF p5: "admin should be able to release a job from On Hold").
 * Until now there was no way out at all — a $0 import sat on the calendar as an
 * unexplained grey block forever, and the only thing that ever moved it was the
 * nightly sweep quietly relabelling it COMPLETED once its date slid past. This
 * is the deliberate exit, and it writes a `STATUS_CHANGED` log carrying the old
 * status and the reason that was cleared, so the release is reversible and
 * auditable exactly like every other status move.
 *
 * ## What it deliberately refuses
 *
 * An UNSETTLED QUOTE. A post-construction booking on hold is waiting for an
 * admin to price it and the customer to accept — `resolveJobQuote` is that flow,
 * and it also decides what happens to the deposit. Releasing one from here would
 * put unpriced work on the calendar and expose it to cleaners (the quote guard
 * in cleaner-jobs.ts keys off `quoteStatus`, not off the hold), so this action
 * sends the admin to the quote panel instead of silently doing half of it.
 *
 * A FLEXIBLE booking is NOT refused. "Confirm a date" is precisely the decision
 * this button records — the admin has agreed a date with the customer, and the
 * job form is where the date itself is set.
 */
export async function releaseJobHold(
  jobId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  // The same gate as `bulkSetJobStatus` — this moves a job onto the schedule,
  // which is dispatch work, not an owner-only money decision.
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }
  if (!jobId?.trim()) return { success: false, error: "Job id is required" };

  const job = await db.job.findFirst({
    where: { id: jobId.trim(), deletedAt: null },
    select: {
      id: true,
      jobNumber: true,
      status: true,
      holdReason: true,
      quoteStatus: true,
      startTime: true,
    },
  });
  if (!job) return { success: false, error: "Job not found" };

  if (!isOnHold(job)) {
    // Not an error worth a red banner — two admins clicking the same row is the
    // ordinary case — but it must not report success either, or the second
    // click would appear to have moved a completed job.
    return { success: false, error: "This job isn't on hold." };
  }

  if (isAwaitingQuote(job.quoteStatus)) {
    return {
      success: false,
      error:
        "This is a quote request — price it and record the customer's answer in the Quote review panel. Accepting the quote schedules the job.",
    };
  }

  const previousReason = holdReasonText(job.holdReason);

  try {
    await db.$transaction([
      db.job.update({
        where: { id: job.id },
        // Status and reason, and nothing else. A hold says nothing about money,
        // payment or the crew, so releasing one must not touch any of them —
        // the same rule `scripts/fixFutureCompletedJobs.ts` follows.
        data: { status: "SCHEDULED", holdReason: null },
      }),
      db.jobLog.create({
        data: {
          jobId: job.id,
          userId: session.user.id,
          action: "STATUS_CHANGED",
          field: "status",
          oldValue: ON_HOLD_STATUS,
          newValue: "SCHEDULED",
          description: `Released from hold by ${
            session.user.name ?? "an admin"
          } — was "${previousReason}".`,
        },
      }),
    ]);
  } catch (e) {
    console.error("releaseJobHold", e);
    return { success: false, error: "Could not release this job" };
  }

  await invalidateCalendarDay(job.startTime.toISOString().slice(0, 10)).catch(
    () => {}
  );
  revalidatePath(`/admin/jobs/${job.id}`);
  revalidatePath("/admin/jobs");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/dashboard");
  return { success: true };
}
