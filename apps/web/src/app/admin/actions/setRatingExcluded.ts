"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAdminRole } from "@/lib/role-routing";
import { recalculateMultiplier } from "./recalculateMultiplier";

/**
 * Exclude a star rating from a cleaner's score, or put it back
 * (AwerNewFixes.pdf item 5).
 *
 * The rating row is never deleted — an excluded rating still shows on its job,
 * marked as excluded, with the reason and who pulled it. What changes is that
 * every average, rating count and pay-tier calculation stops counting it (all
 * of those read `excludedAt: null`).
 *
 * Typical uses: a rating left on a test job, a cancelled job, an obvious
 * mis-tap, or a complaint the office resolved in the cleaner's favour.
 */

export type SetRatingExcludedResult =
  | { success: true; excluded: boolean; multiplierChanged: boolean }
  | { success: false; error: string };

export async function setRatingExcluded(input: {
  ratingId: string;
  excluded: boolean;
  reason?: string;
}): Promise<SetRatingExcludedResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) return { success: false, error: "Not authorized" };

  const rating = await db.employeeRating.findUnique({
    where: { id: input.ratingId },
    select: { id: true, employeeId: true, jobId: true, rating: true, excludedAt: true },
  });
  if (!rating) return { success: false, error: "Rating not found" };

  const now = new Date();
  await db.employeeRating.update({
    where: { id: rating.id },
    data: input.excluded
      ? {
          excludedAt: now,
          excludedById: session.user.id,
          excludedReason: input.reason?.trim() || null,
        }
      : // Restoring clears the whole exclusion record — the rating counts again.
        { excludedAt: null, excludedById: null, excludedReason: null },
  });

  // The cleaner's average just moved, so the pay multiplier derived from it has
  // to be recomputed — otherwise the tier keeps reflecting the pulled rating.
  const recalc = await recalculateMultiplier({ employeeId: rating.employeeId });
  const multiplierChanged = "changed" in recalc ? !!recalc.changed : false;

  // Audit trail on the job the rating belongs to, so the removal is reviewable
  // next to everything else that happened on that booking.
  if (rating.jobId) {
    await db.jobLog
      .create({
        data: {
          jobId: rating.jobId,
          userId: session.user.id,
          action: "UPDATED",
          field: "rating",
          oldValue: rating.excludedAt ? "excluded" : "active",
          newValue: input.excluded ? "excluded" : "active",
          description: input.excluded
            ? `${rating.rating}-star rating excluded from the cleaner's score by ${session.user.name ?? "an admin"}${
                input.reason?.trim() ? ` — ${input.reason.trim()}` : ""
              }`
            : `${rating.rating}-star rating restored to the cleaner's score by ${session.user.name ?? "an admin"}`,
        },
      })
      .catch((e) => console.error("rating-exclusion log", e));

    revalidatePath(`/admin/jobs/${rating.jobId}`);
  }

  revalidatePath(`/admin/employees/${rating.employeeId}`);
  revalidatePath("/admin/analytics");

  return { success: true, excluded: input.excluded, multiplierChanged };
}
