"use server";

import { db } from "@/db";
import {
  sendAdminNewReview,
  sendProviderNewReview,
  sendCustomerPoorRatingFollowUp,
} from "@/lib/email";
import { POOR_RATING_FOLLOWUP_STARS, applyLateArrivalPenalty } from "@/lib/policy";
import { maybeApplyLowRatingStrike } from "@/lib/strikes";

interface SubmitRatingInput {
  token: string;
  stars: number;
  comment?: string;
  /** URLs of client-attached photos (poor reviews only). Optional. */
  photoUrls?: string[];
}

export async function submitRating(input: SubmitRatingInput) {
  try {
    if (!input.token) return { success: false, error: "Missing token" };
    if (
      !Number.isInteger(input.stars) ||
      input.stars < 1 ||
      input.stars > 5
    ) {
      return { success: false, error: "Rating must be 1-5 stars" };
    }

    const tokenRow = await db.jobRatingToken.findUnique({
      where: { token: input.token },
      include: {
        job: {
          include: {
            cleaners: { select: { id: true } },
          },
        },
      },
    });
    // Apply the late-arrival rating penalty if one was set on the job at
    // clock-in — a flat deduction (never below the floor), not a cap.
    const effectiveStars = applyLateArrivalPenalty(
      input.stars,
      tokenRow?.job?.lateArrivalRatingPenalty
    );

    if (!tokenRow) return { success: false, error: "Invalid rating link" };
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      return { success: false, error: "This rating link has expired" };
    }
    // A used token means the client is editing their previous rating.
    const isEdit = !!tokenRow.usedAt;

    // Cleaners to rate: prefer the explicit cleaner on the token, fall back
    // to all cleaners assigned to the job.
    const cleanerIds = tokenRow.cleanerId
      ? [tokenRow.cleanerId]
      : tokenRow.job.cleaners.map((c) => c.id);

    if (cleanerIds.length === 0) {
      return {
        success: false,
        error: "No cleaners were assigned to this job",
      };
    }

    const ratingNotes =
      effectiveStars !== input.stars
        ? `${input.comment?.trim() ?? ""}${input.comment?.trim() ? " | " : ""}Late-arrival penalty applied (${input.stars} → ${effectiveStars})`.trim()
        : input.comment?.trim() || null;

    if (isEdit) {
      // Update the rating rows created by the original submission in place
      // (averages are computed live, so no separate recalc is needed).
      const existing = await db.employeeRating.findMany({
        where: {
          jobId: tokenRow.jobId,
          employeeId: { in: cleanerIds },
          ratedBy: { in: ["client-link", "client-portal"] },
        },
        select: { id: true, employeeId: true },
      });
      const editedAt = new Date();
      await db.$transaction([
        ...cleanerIds.map((employeeId) => {
          const row = existing.find((r) => r.employeeId === employeeId);
          return row
            ? db.employeeRating.update({
                where: { id: row.id },
                data: { rating: effectiveStars, notes: ratingNotes, editedAt },
              })
            : db.employeeRating.create({
                data: {
                  jobId: tokenRow.jobId,
                  employeeId,
                  rating: effectiveStars,
                  notes: ratingNotes,
                  ratedBy: "client-link",
                  editedAt,
                },
              });
        }),
        db.jobRatingToken.update({
          where: { id: tokenRow.id },
          data: { ratingStars: input.stars },
        }),
      ]);
    } else {
      await db.$transaction([
        ...cleanerIds.map((employeeId) =>
          db.employeeRating.create({
            data: {
              jobId: tokenRow.jobId,
              employeeId,
              rating: effectiveStars,
              notes: ratingNotes,
              ratedBy: "client-link",
            },
          })
        ),
        db.jobRatingToken.update({
          where: { id: tokenRow.id },
          data: { usedAt: new Date(), ratingStars: input.stars },
        }),
      ]);
    }

    // Persist any client-attached review photos (poor reviews). Sanitized to
    // valid http(s) URLs, capped at 5.
    const photoUrls = (input.photoUrls ?? [])
      .filter(
        (u): u is string =>
          typeof u === "string" && /^https?:\/\//i.test(u.trim())
      )
      .map((u) => u.trim())
      .slice(0, 5);
    if (photoUrls.length > 0) {
      await db.reviewPhoto
        .createMany({
          data: photoUrls.map((url) => ({
            jobId: tokenRow.jobId,
            url,
            rating: input.stars,
          })),
        })
        .catch((e) => console.error("review photo save", e));
    }

    // Notify admin + each rated cleaner (gated). Recalc overall for the
    // `overall_dropped` check.
    const job = await db.job.findUnique({
      where: { id: tokenRow.jobId },
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        client: { select: { email: true, name: true } },
      },
    });

    // 1-star follow-up: email the customer + create a CRITICAL admin alert.
    // On edits, only fire when the rating newly drops to poor.
    const wasPoor =
      isEdit &&
      tokenRow.ratingStars != null &&
      tokenRow.ratingStars <= POOR_RATING_FOLLOWUP_STARS;
    if (input.stars <= POOR_RATING_FOLLOWUP_STARS && !wasPoor) {
      const clientEmail = job?.client?.email ?? null;
      const clientName =
        job?.client?.name ?? job?.clientName ?? "the customer";
      if (clientEmail && job) {
        sendCustomerPoorRatingFollowUp({
          to: clientEmail,
          clientName,
          jobNumber: job.jobNumber,
        }).catch((e) => console.error("poor-rating follow-up email", e));
      }
      if (job) {
        await db.alert
          .create({
            data: {
              type: "CLIENT_COMPLAINT",
              severity: "CRITICAL",
              title: `1-star rating — ${clientName}`,
              message: `Booking #${job.jobNumber} received a 1-star rating${
                input.comment?.trim() ? `: "${input.comment.trim()}"` : "."
              } Customer was promised a follow-up; reach out with compensation.`,
              relatedId: job.id,
              relatedType: "Job",
            },
          })
          .catch((e) => console.error("poor-rating admin alert", e));
      }
    }
    for (const employeeId of cleanerIds) {
      const cleaner = await db.user.findUnique({
        where: { id: employeeId },
        select: { name: true, email: true },
      });
      if (!cleaner) continue;
      const allRatings = await db.employeeRating.aggregate({
        // Excluded ratings are out of the quoted overall score (item 5).
        where: { employeeId, excludedAt: null },
        _avg: { rating: true },
      });
      const overall = allRatings._avg.rating ?? null;
      sendAdminNewReview({
        jobId: job?.id ?? null,
        jobNumber: job?.jobNumber ?? null,
        employeeName: cleaner.name,
        rating: effectiveStars,
        notes: input.comment?.trim() || null,
        overallRating: overall,
      }).catch((e) => console.error("admin new-review email", e));
      if (cleaner.email) {
        sendProviderNewReview({
          to: cleaner.email,
          employeeName: cleaner.name,
          jobId: job?.id ?? null,
          jobNumber: job?.jobNumber ?? null,
          rating: effectiveStars,
          notes: input.comment?.trim() || null,
        }).catch((e) => console.error("provider new-review email", e));
      }
      // Accountability: two consecutive sub-3-star customer ratings → strike.
      await maybeApplyLowRatingStrike(employeeId, tokenRow.jobId).catch((e) =>
        console.error("low-rating strike", e)
      );
    }

    return { success: true };
  } catch (error) {
    console.error("Error submitting rating:", error);
    return { success: false, error: "Failed to submit rating" };
  }
}
