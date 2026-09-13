"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { RATING_MIN, RATING_MAX, DEFAULT_STARTING_RATING } from "@/lib/policy";
import { getCleanerRatingSummary } from "@/lib/cleaner-rating.server";

export async function setEmployeeRating(
  employeeId: string,
  rating: number
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const clamped =
    Math.round(Math.min(RATING_MAX, Math.max(RATING_MIN, rating)) * 10) / 10;

  await db.employeeRating.create({
    data: {
      employeeId,
      rating: clamped,
      ratedBy: session.user.id,
      notes: "Admin manual override",
    },
  });

  revalidatePath(`/admin/employees/${employeeId}`);
  return { success: true };
}

/**
 * ADMIN PROFILE ONLY. Cleaner-facing pages must call `getCleanerRatingSummary`
 * (@/lib/cleaner-rating.server) instead — they also need the review count, and
 * they must show "No reviews yet" rather than the starting rating below.
 *
 * The average itself is no longer computed here: it comes from the one shared
 * definition, so this view can never drift from the dashboard and My Pay the
 * way it used to. The only thing this wrapper adds is the display-only starting
 * rating for a cleaner with nothing rated yet (DEFAULT_STARTING_RATING, see
 * policy.ts — pay stays locked at the 40% floor until 5 ratings exist, so it
 * cannot inflate anyone's money).
 */
export async function getEmployeeAvgRating(employeeId: string): Promise<number | null> {
  const { average } = await getCleanerRatingSummary(employeeId);
  return average ?? DEFAULT_STARTING_RATING;
}
