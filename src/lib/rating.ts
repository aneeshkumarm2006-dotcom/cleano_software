import { db } from "@/lib/org-db";
import { randomBytes } from "crypto";
import { sendCustomerRateUs } from "@/lib/email";

const RATING_TOKEN_TTL_DAYS = 30;

/**
 * Ensure a completed job has a rating token and that the customer has been
 * asked (once) to rate the cleaning by email.
 *
 * This is the single entry point for the post-cleaning rating flow. It is
 * idempotent: it mints at most one {@link JobRatingToken} per job and sends
 * the "rate us" email at most once. Both the email link (`/rate/[token]`) and
 * the customer-portal pop-up operate on the same token, so the customer is
 * never double-prompted for the same job.
 *
 * Safe to call fire-and-forget from any job-completion path (admin mark
 * complete, cleaner clock-out, bulk charge, etc.).
 */
export async function ensureRatingRequest(jobId: string): Promise<void> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      clientId: true,
      employeeId: true,
      client: { select: { id: true, name: true, email: true } },
      cleaners: { select: { id: true } },
    },
  });
  if (!job) return;

  // Need at least one cleaner to rate.
  const primaryCleanerId =
    job.employeeId ?? job.cleaners[0]?.id ?? null;
  if (!primaryCleanerId) return;

  // Mint the token once per job. The portal pop-up still works even when the
  // customer has no email on file, so we always create the token; the email
  // send below is what's gated on having an address.
  let tokenRow = await db.jobRatingToken.findFirst({
    where: { jobId: job.id },
    orderBy: { createdAt: "desc" },
  });

  if (!tokenRow) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + RATING_TOKEN_TTL_DAYS);
    tokenRow = await db.jobRatingToken.create({
      data: {
        jobId: job.id,
        token: randomBytes(24).toString("base64url"),
        cleanerId: primaryCleanerId,
        customerId: job.clientId ?? job.client?.id ?? null,
        expiresAt,
      },
    });
  }

  // Send the "rate your cleaning" email at most once.
  const to = job.client?.email ?? null;
  if (to && !tokenRow.emailSentAt) {
    const clientName = job.client?.name ?? job.clientName ?? "there";

    // Stamp first so concurrent completion events don't double-send.
    await db.jobRatingToken.update({
      where: { id: tokenRow.id },
      data: { emailSentAt: new Date() },
    });

    const log = await db.emailLog.create({
      data: {
        kind: "RATING_REQUEST",
        recipient: to,
        subject: `Rate your Cleano cleaning — job #${job.jobNumber}`,
        status: "PENDING",
        jobId: job.id,
      },
    });

    try {
      const result = await sendCustomerRateUs({
        to,
        clientName,
        jobId: job.id,
        jobNumber: job.jobNumber,
        ratingToken: tokenRow.token,
      });
      if (!result.ok && !("skipped" in result && result.skipped)) {
        await db.emailLog.update({
          where: { id: log.id },
          data: {
            status: "FAILED",
            error: String((result as { error?: unknown }).error ?? "send failed"),
          },
        });
      } else if (result.ok) {
        await db.emailLog.update({
          where: { id: log.id },
          data: { status: "SENT", sentAt: new Date() },
        });
      } else {
        // Skipped by admin notification settings.
        await db.emailLog.update({
          where: { id: log.id },
          data: { status: "FAILED", error: "Disabled in Settings → Notifications" },
        });
      }
    } catch (e) {
      await db.emailLog
        .update({
          where: { id: log.id },
          data: { status: "FAILED", error: String((e as Error)?.message ?? e) },
        })
        .catch(() => {});
    }
  }
}
