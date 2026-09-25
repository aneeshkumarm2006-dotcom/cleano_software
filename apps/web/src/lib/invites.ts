/**
 * Accept / decline workflow helpers.
 *
 * TWO DIFFERENT THINGS SHARE THIS TABLE, and the difference is the whole of
 * awerfixes.pdf item 4:
 *
 *   • DIRECT (`isLastMinute: false`) — an admin assigned this cleaner. They are
 *     ALREADY ON THE JOB; the invite is a request to confirm, not a hold. It
 *     does not lapse. Nothing unassigns them except an admin or their own
 *     decline. `expiresAt` on these rows is now only the timer for the admin's
 *     "assignment unconfirmed" nudge — the cleaner never sees it, and the cron
 *     sweep no longer stamps them EXPIRED.
 *
 *   • LAST-MINUTE (`isLastMinute: true`) — a broadcast for an OPEN job after
 *     somebody cancelled. This one is a genuine race: first to accept gets it,
 *     the rest expire. Hard expiry is correct here and is kept.
 *
 * The old model (documented here until this change) was that a non-response
 * released the job back to the unassigned pool. That stopped being true in
 * AWER_NEW_FIXES item 2 — expiry became a flag plus an admin alert — but the
 * cleaner-facing countdown kept threatening it.
 */

import { db } from "@/lib/org-db";
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
    select: { notifyProvider: true, deletedAt: true },
  });
  if (job && !job.notifyProvider) return [];
  // Never ask a cleaner to accept an archived booking. `respondToJobInvite`
  // refuses the answer, so an invite sent here could only ever be a dead end —
  // and `cancelShift` would otherwise broadcast a paid last-minute claim for
  // work that no longer exists. Guarded centrally because all five senders
  // (assignCleaners, cancelShift, saveJob ×3) come through here.
  if (job?.deletedAt) return [];

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
          // Re-assigning re-arms the invite, so it must re-arm the admin
          // nudge too — otherwise a cleaner re-invited after an earlier
          // unconfirmed round would never be chased again.
          unconfirmedAlertAt: null,
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
