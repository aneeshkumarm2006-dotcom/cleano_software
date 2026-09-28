"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { RATING_MULTIPLIER_SETTING_KEY } from "@/lib/pay-multiplier-config";

/** Bind-parameter safety for `id: { in: [...] }`. */
const CHUNK = 500;
function chunk<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

export interface RecalculateAllResult {
  success: boolean;
  error?: string;
  /** Active users considered. */
  total?: number;
  /** How many actually moved. */
  changed?: number;
}

/**
 * Refresh EVERY active cleaner's `User.payMultiplier` display cache.
 *
 * Runs after Settings → Pay Rate Multipliers is saved, because every cached
 * number on every profile derives from the map that just changed. PAY is
 * unaffected by a failure here — getCleanerRateInputs resolves the multiplier
 * live at payout time — so this is a cosmetic refresh, never a payroll write.
 */
export async function recalculateAllMultipliers(): Promise<RecalculateAllResult> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    // `User` holds staff only (customers live on Client), and an OWNER/ADMIN who
    // genuinely works jobs is paid like anyone else — so no role filter.
    const users = await db.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, payMultiplier: true },
    });
    if (users.length === 0) return { success: true, total: 0, changed: 0 };

    // ONE resolution pass through the same loader payroll uses, so the cache
    // cannot disagree with the rate a cleaner is actually paid.
    const rates = await getCleanerRateInputs(users.map((u) => u.id));

    // The multiplier only ever takes one of the ~11 configured values, so the
    // writes collapse to at most 11 statements no matter how many cleaners
    // exist — no per-row update loop.
    const byValue = new Map<number, string[]>();
    let changed = 0;
    for (const u of users) {
      const next = rates.get(u.id)?.multiplier ?? 1;
      if (Math.abs(u.payMultiplier - next) > 0.001) changed++;
      const bucket = byValue.get(next);
      if (bucket) bucket.push(u.id);
      else byValue.set(next, [u.id]);
    }

    const now = new Date();
    for (const [value, ids] of byValue) {
      for (const part of chunk(ids)) {
        await db.user.updateMany({
          where: { id: { in: part } },
          data: { payMultiplier: value, multiplierLastRecalculatedAt: now },
        });
      }
    }

    // ONE summary alert. Per-cleaner alerts (what recalculateMultiplier writes)
    // would mean dozens of notifications for a single settings save.
    if (changed > 0) {
      await db.alert.create({
        data: {
          type: "GENERAL",
          severity: "INFO",
          title: "Pay multipliers recalculated",
          message: `Rating multipliers were re-applied to ${users.length} active cleaners — ${changed} changed.`,
          relatedId: RATING_MULTIPLIER_SETTING_KEY,
          relatedType: "AppSetting",
        },
      });
    }

    revalidatePath("/admin/settings");
    revalidatePath("/admin/employees");
    return { success: true, total: users.length, changed };
  } catch (error) {
    console.error("Error recalculating all multipliers:", error);
    return { success: false, error: "Failed to recalculate multipliers" };
  }
}
