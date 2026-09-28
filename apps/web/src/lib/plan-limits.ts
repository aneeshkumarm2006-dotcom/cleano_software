import "server-only";

import { cache } from "react";

import type { OrgPlan } from "@prisma/client";

import { db } from "@/lib/org-db";
import { getCurrentOrg } from "@/lib/org";
import { PLANS, cleanerLimitFor } from "@/lib/plans";
import { CLEANER_SEAT_WHERE } from "@/lib/seat-rules";

/**
 * What a plan actually allows, enforced rather than displayed.
 *
 * Up to now the cleaner cap has been a number on a pricing page. This is the
 * module that makes it true. The rules for what counts as a seat are pure and
 * live in seat-rules.ts; this is the part that needs a database.
 */

export { CLEANER_SEAT_WHERE, takesASeat } from "@/lib/seat-rules";

export interface SeatUsage {
  used: number;
  /** NULL means uncapped. */
  limit: number | null;
  /** NULL when uncapped. Never negative. */
  remaining: number | null;
  atCap: boolean;
  plan: OrgPlan;
  planLabel: string;
}

/**
 * Seats for the organization serving this request.
 *
 * Cached per request: a page that shows the count and then an action that checks
 * it should not disagree with itself, and it costs one query either way.
 */
export const cleanerSeatUsage = cache(async (): Promise<SeatUsage> => {
  const [org, sub, used] = await Promise.all([
    getCurrentOrg(),
    db.subscription.findFirst({ select: { plan: true, seats: true } }),
    db.user.count({ where: CLEANER_SEAT_WHERE }),
  ]);

  // The subscription is what billing acts on, so it wins where the two differ;
  // the organization's own plan is the fallback for a workspace that has no
  // subscription row yet.
  const plan = sub?.plan ?? org?.plan ?? "STARTER";
  const limit = cleanerLimitFor(plan, sub?.seats ?? null);

  return {
    used,
    limit,
    remaining: limit == null ? null : Math.max(limit - used, 0),
    atCap: limit != null && used >= limit,
    plan,
    planLabel: PLANS[plan].label,
  };
});

export type SeatCheck =
  | { ok: true; usage: SeatUsage }
  | { ok: false; message: string; usage: SeatUsage };

/**
 * May this workspace take on `adding` more cleaners right now?
 *
 * Returns a result rather than throwing, because every caller is a form action
 * that already knows how to show a sentence, and an error page in the middle of
 * hiring someone tells an admin nothing they can act on.
 *
 * The message says what to do, not just what went wrong: a limit that only says
 * "no" sends someone to support to be told the same thing more slowly.
 */
export async function checkCleanerSeats(adding = 1): Promise<SeatCheck> {
  const usage = await cleanerSeatUsage();
  if (usage.limit == null) return { ok: true, usage };
  if (usage.used + adding <= usage.limit) return { ok: true, usage };

  const plural = (n: number) => `${n} cleaner${n === 1 ? "" : "s"}`;

  const message =
    usage.remaining === 0
      ? `${usage.planLabel} covers ${plural(usage.limit)} and all ${usage.limit} are in use. ` +
        `Deactivate someone who has left to free a seat, or move up a plan to add more.`
      : `${usage.planLabel} covers ${plural(usage.limit)} and ${usage.used} are in use, ` +
        `so there is room for ${plural(usage.remaining ?? 0)}, not ${adding}. ` +
        `Deactivate anyone who has left, or move up a plan.`;

  return { ok: false, message, usage };
}
