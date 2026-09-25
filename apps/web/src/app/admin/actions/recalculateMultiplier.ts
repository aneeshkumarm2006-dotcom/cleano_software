"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ratingStepFor } from "@/lib/pay-multiplier";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { STANDARD_RATINGS_REQUIRED } from "@/lib/pay-tiers";

interface RecalculateInput {
  employeeId?: string;
}

/**
 * Refresh ONE cleaner's `User.payMultiplier` — the DISPLAY CACHE shown on the
 * Profile and Performance tabs.
 *
 * Pay does not read this column: getCleanerRateInputs() resolves the multiplier
 * live at payout time. This exists so the number a cleaner SEES matches the
 * number they are PAID — which is exactly why the rating math is delegated to
 * that same loader rather than re-implemented here, where it would drift.
 *
 * Window (Decision 2, 2026-08-06): ALL TIME. getCleanerRateInputs aggregates
 * with `excludedAt: null`, so admin-excluded ratings never reach pay or this
 * cache. It used to use a hardcoded 30-day window, which disagreed with both
 * the pay tier and the profile average.
 *
 * Below STANDARD_RATINGS_REQUIRED ratings — INCLUDING ZERO — the multiplier is
 * 1.0 and is WRITTEN as 1.0. The previous version early-returned on zero
 * ratings, so a cleaner whose ratings were all excluded kept a stale premium
 * on display forever.
 */
export async function recalculateMultiplier(input: RecalculateInput = {}) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    if (!isAdmin) {
      return { success: false, error: "Not authorized" };
    }
    const targetEmployeeId = input.employeeId || session.user.id;

    const [employee, rateInputs] = await Promise.all([
      db.user.findUnique({
        where: { id: targetEmployeeId },
        select: { id: true, name: true, payMultiplier: true },
      }),
      getCleanerRateInputs([targetEmployeeId]),
    ]);
    if (!employee) {
      return { success: false, error: "Employee not found" };
    }

    const resolved = rateInputs.get(targetEmployeeId);
    const avg = resolved?.avgRating ?? null;
    const ratingCount = resolved?.ratingCount ?? 0;
    const multiplier = resolved?.multiplier ?? 1;
    const label =
      avg != null && ratingCount >= STANDARD_RATINGS_REQUIRED
        ? ratingStepFor(avg)
        : null;

    const oldMultiplier = employee.payMultiplier;
    const changed = Math.abs(oldMultiplier - multiplier) > 0.001;

    // Stamped on EVERY run, changed or not: the column records when the
    // multiplier was last CHECKED. Declared since the 20260511000000 migration
    // and written by nothing until now.
    await db.user.update({
      where: { id: targetEmployeeId },
      data: {
        payMultiplier: multiplier,
        multiplierLastRecalculatedAt: new Date(),
      },
    });

    if (changed) {
      await db.alert.create({
        data: {
          type: "GENERAL",
          severity: "INFO",
          title: "Pay multiplier updated",
          message:
            label === null
              ? `${employee.name}'s pay multiplier reset to 1.00x — only ${ratingCount}/${STANDARD_RATINGS_REQUIRED} ratings count (was ${oldMultiplier.toFixed(2)}x)`
              : `${employee.name}'s pay multiplier moved from ${oldMultiplier.toFixed(2)}x to ${multiplier.toFixed(2)}x (${label} tier, all-time avg ${(avg ?? 0).toFixed(2)} over ${ratingCount} ratings)`,
          relatedId: targetEmployeeId,
          relatedType: "User",
        },
      });

      revalidatePath("/admin/settings");
      revalidatePath(`/admin/employees/${targetEmployeeId}`);
    }

    // Return shape is UNCHANGED — setRatingExcluded.ts reads `.changed` and
    // submitRating.ts awaits it.
    return {
      success: true,
      averageRating: avg,
      oldMultiplier,
      newMultiplier: multiplier,
      tierLabel: label,
      changed,
      ratingCount,
    };
  } catch (error) {
    console.error("Error recalculating multiplier:", error);
    return { success: false, error: "Failed to recalculate multiplier" };
  }
}
