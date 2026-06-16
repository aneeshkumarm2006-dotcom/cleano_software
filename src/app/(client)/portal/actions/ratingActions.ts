"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendCustomerPoorRatingFollowUp } from "@/lib/email";
import { POOR_RATING_FOLLOWUP_STARS, applyLateArrivalPenalty } from "@/lib/policy";
import { maybeApplyLowRatingStrike } from "@/lib/strikes";

export interface PendingRatingJob {
  token: string;
  jobId: string;
  jobNumber: number;
  cleanerName: string;
  completedAt: string;
}

/**
 * Resolve the Client record for the logged-in portal session.
 */
async function getSessionClientId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const email = session.user.email?.toLowerCase();
  if (!email) return null;
  const client = await db.client.findFirst({
    where: { email },
    select: { id: true },
  });
  return client?.id ?? null;
}

/**
 * The next completed job awaiting a customer rating. Backed by
 * {@link JobRatingToken}, which is the same token the "rate us" email links
 * to — so rating by email suppresses this pop-up and vice-versa. The pop-up
 * keeps re-appearing until the customer rates or clicks "Rather not answer".
 */
export async function getPendingClientRating(): Promise<PendingRatingJob | null> {
  const clientId = await getSessionClientId();
  if (!clientId) return null;

  const now = new Date();
  const tokenRow = await db.jobRatingToken.findFirst({
    where: {
      customerId: clientId,
      usedAt: null,
      ratherNotAnswer: false,
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      job: { status: { in: ["COMPLETED", "PAID"] } },
    },
    orderBy: { createdAt: "desc" },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          jobDate: true,
          startTime: true,
          employee: { select: { name: true } },
          cleaners: { select: { name: true } },
        },
      },
    },
  });

  if (!tokenRow) return null;

  const cleanerName =
    tokenRow.job.employee?.name ??
    tokenRow.job.cleaners[0]?.name ??
    "your cleaner";

  // Record that we showed the pop-up (first time only).
  if (!tokenRow.popupShownAt) {
    await db.jobRatingToken
      .update({
        where: { id: tokenRow.id },
        data: { popupShownAt: now },
      })
      .catch(() => {});
  }

  return {
    token: tokenRow.token,
    jobId: tokenRow.job.id,
    jobNumber: tokenRow.job.jobNumber,
    cleanerName,
    completedAt: (tokenRow.job.jobDate ?? tokenRow.job.startTime).toISOString(),
  };
}

/**
 * Submit (or decline) a customer rating from the portal pop-up.
 *
 * Ratings are stored on the 1–5 star scale — identical to the email rating
 * link — so a cleaner's average means the same thing regardless of which
 * channel the customer used. "Rather not answer" only flips the token's
 * `ratherNotAnswer` flag; it never writes a rating row, so declining can't
 * drag down the cleaner's average.
 */
export async function submitCustomerRating(
  token: string,
  stars: number,
  skipped: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  const clientId = await getSessionClientId();
  if (!clientId) return { success: false, error: "Not authenticated" };

  const tokenRow = await db.jobRatingToken.findUnique({
    where: { token },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          clientName: true,
          clientId: true,
          lateArrivalRatingPenalty: true,
          employeeId: true,
          client: { select: { email: true, name: true } },
          cleaners: { select: { id: true } },
        },
      },
    },
  });

  if (!tokenRow) return { success: false, error: "Rating link not found" };
  if (tokenRow.customerId && tokenRow.customerId !== clientId) {
    return { success: false, error: "Not authorized" };
  }
  if (tokenRow.job.clientId && tokenRow.job.clientId !== clientId) {
    return { success: false, error: "Not authorized" };
  }
  if (tokenRow.usedAt || tokenRow.ratherNotAnswer) {
    // Already handled — treat as success so the pop-up just closes.
    return { success: true };
  }

  if (skipped) {
    await db.jobRatingToken.update({
      where: { id: tokenRow.id },
      data: { ratherNotAnswer: true },
    });
    revalidatePath("/portal");
    return { success: true };
  }

  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return { success: false, error: "Rating must be 1–5 stars" };
  }

  // Apply the late-arrival penalty (flat deduction, never below the floor).
  const effectiveStars = applyLateArrivalPenalty(
    stars,
    tokenRow.job.lateArrivalRatingPenalty
  );

  const cleanerIds = tokenRow.cleanerId
    ? [tokenRow.cleanerId]
    : tokenRow.job.employeeId
    ? [tokenRow.job.employeeId]
    : tokenRow.job.cleaners.map((c) => c.id);

  if (cleanerIds.length === 0) {
    return { success: false, error: "No cleaners were assigned to this job" };
  }

  await db.$transaction([
    ...cleanerIds.map((employeeId) =>
      db.employeeRating.create({
        data: {
          jobId: tokenRow.job.id,
          employeeId,
          rating: effectiveStars,
          notes:
            effectiveStars !== stars
              ? `Late-arrival cap applied (${stars} → ${effectiveStars})`
              : null,
          ratedBy: "client-portal",
        },
      })
    ),
    db.jobRatingToken.update({
      where: { id: tokenRow.id },
      data: { usedAt: new Date(), ratingStars: stars },
    }),
  ]);

  // Accountability: two consecutive sub-3-star customer ratings → strike.
  for (const cleanerId of cleanerIds) {
    await maybeApplyLowRatingStrike(cleanerId, tokenRow.job.id).catch((e) =>
      console.error("low-rating strike", e)
    );
  }

  // 1-star follow-up: reassure the customer + raise a CRITICAL admin alert.
  if (stars <= POOR_RATING_FOLLOWUP_STARS) {
    const clientEmail = tokenRow.job.client?.email ?? null;
    const clientName =
      tokenRow.job.client?.name ?? tokenRow.job.clientName ?? "the customer";
    if (clientEmail) {
      sendCustomerPoorRatingFollowUp({
        to: clientEmail,
        clientName,
        jobNumber: tokenRow.job.jobNumber,
      }).catch((e) => console.error("poor-rating follow-up email", e));
    }
    await db.alert
      .create({
        data: {
          type: "CLIENT_COMPLAINT",
          severity: "CRITICAL",
          title: `1-star rating — ${clientName}`,
          message: `Booking #${tokenRow.job.jobNumber} received a 1-star rating. Customer was promised a follow-up; reach out with compensation.`,
          relatedId: tokenRow.job.id,
          relatedType: "Job",
        },
      })
      .catch((e) => console.error("poor-rating admin alert", e));
  }

  revalidatePath("/portal");
  return { success: true };
}
