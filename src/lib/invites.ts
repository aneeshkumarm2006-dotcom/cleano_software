/**
 * Accept / decline workflow helpers.
 *
 * When a cleaner is added to a job, we create a JobAssignmentInvite with
 * an expiry of the configured accept/decline timeout (admin setting
 * `scheduling.acceptDeclineTimeoutMin`) from now. The cleaner accepts or
 * declines from /my-jobs; if they don't respond in time the cron sweep marks
 * it EXPIRED and removes them from the job.
 */

import { db } from "@/db";
import { getSetting } from "@/lib/settings";

interface CreateInviteOpts {
  jobId: string;
  cleanerIds: string[];
  isLastMinute?: boolean;
  bonusUsd?: number;
}

export async function createAssignmentInvites(opts: CreateInviteOpts) {
  if (opts.cleanerIds.length === 0) return [];

  // Per-booking notification control: when provider notifications are turned
  // off for this job, skip the accept/decline invite ping — the cleaners stay
  // directly assigned without being prompted.
  const job = await db.job.findUnique({
    where: { id: opts.jobId },
    select: { notifyProvider: true },
  });
  if (job && !job.notifyProvider) return [];

  const now = new Date();
  const timeoutMin = await getSetting("scheduling.acceptDeclineTimeoutMin");
  const expiresAt = new Date(now.getTime() + timeoutMin * 60_000);
  const isLastMinute = opts.isLastMinute ?? false;
  const bonusUsd = opts.bonusUsd ?? 0;

  const created: Array<{ id: string; cleanerId: string }> = [];
  for (const cleanerId of opts.cleanerIds) {
    try {
      const invite = await db.jobAssignmentInvite.upsert({
        where: {
          jobId_cleanerId: { jobId: opts.jobId, cleanerId },
        },
        update: {
          decision: "PENDING",
          sentAt: now,
          respondedAt: null,
          expiresAt,
          declineReason: null,
          isLastMinute,
          bonusUsd,
        },
        create: {
          jobId: opts.jobId,
          cleanerId,
          sentAt: now,
          expiresAt,
          isLastMinute,
          bonusUsd,
        },
        select: { id: true, cleanerId: true },
      });
      created.push(invite);
    } catch (e) {
      console.error("createAssignmentInvites: upsert failed", cleanerId, e);
    }
  }
  return created;
}
