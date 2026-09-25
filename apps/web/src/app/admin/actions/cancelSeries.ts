"use server";

import { revalidatePath } from "next/cache";

import { requireOwnerAdmin } from "@/lib/action-guards";
import { logActivity } from "@/lib/activity-log";
import {
  cancelJobSeries,
  planSeriesCancellation,
  type SeriesCancelScope,
} from "@/lib/job-series";

/**
 * The rest of a recurring schedule, cancelled or paused.
 *
 * Deliberately does NOT cancel the occurrence the admin is looking at: that
 * one goes through cancelJobByAdmin, which owns the customer email, the
 * deposit refund and the late-cancellation fee. Two code paths cancelling the
 * same job would either charge the fee twice or skip it entirely.
 */
export async function previewSeriesCancellation(input: {
  jobId: string;
  scope: string;
  pauseUntil?: string | null;
}): Promise<
  | {
      ok: true;
      siblings: number;
      protectedCount: number;
      resumesOn: string | null;
      /** The span the confirm would clear, this occurrence included. */
      rangeStart: string | null;
      rangeEnd: string | null;
      /** The last booking left in the schedule, for a "pause". */
      lastOccurrence: string | null;
      /** A "pause" that reaches past every remaining booking — an ENDING. */
      endsSeries: boolean;
    }
  | { ok: false; message: string }
> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  const scope = normalizeScope(input.scope);
  const until = parseUntil(input.pauseUntil);
  if (scope === "pause" && !until) {
    return { ok: false, message: "Pick the date the schedule should resume after." };
  }

  const plan = await planSeriesCancellation(input.jobId, scope, until);
  return {
    ok: true,
    siblings: plan.siblings,
    protectedCount: plan.protectedCount,
    resumesOn: plan.resumesOn?.toISOString() ?? null,
    rangeStart: plan.rangeStart?.toISOString() ?? null,
    rangeEnd: plan.rangeEnd?.toISOString() ?? null,
    lastOccurrence: plan.lastOccurrence?.toISOString() ?? null,
    endsSeries: plan.endsSeries,
  };
}

export async function applySeriesCancellation(input: {
  jobId: string;
  scope: string;
  pauseUntil?: string | null;
  reason?: string | null;
}): Promise<{ ok: true; cancelled: number } | { ok: false; message: string }> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  const scope = normalizeScope(input.scope);
  if (scope === "this") return { ok: true, cancelled: 0 };
  const until = parseUntil(input.pauseUntil);
  if (scope === "pause" && !until) {
    return { ok: false, message: "Pick the date the schedule should resume after." };
  }

  // A pause whose resume date lies past every remaining booking is not a
  // pause: it cancels the whole rest of the schedule and nothing ever brings
  // it back, because occurrences are written once at creation and no cron
  // tops them up (see SeriesCancelPlan.endsSeries). The drawer warns before
  // the button, and this is the same answer on the server — so the schedule
  // cannot be killed by a stale panel, a double-click or any other caller.
  // Ending a schedule on purpose still has its own scope: "future".
  if (scope === "pause") {
    const plan = await planSeriesCancellation(input.jobId, scope, until);
    if (plan.endsSeries) {
      return {
        ok: false,
        message:
          "That resume date is after the last booking in this schedule, so pausing would end it — nothing is generated after the last occurrence. Pick an earlier resume date, or choose “Cancel this and all future bookings” to end the schedule on purpose.",
      };
    }
  }

  const res = await cancelJobSeries(input.jobId, scope, {
    pauseUntil: until,
    reason: input.reason ?? null,
  });

  await logActivity({
    category: "BOOKING",
    action: scope === "pause" ? "series.paused" : "series.cancelled",
    status: "SUCCESS",
    actorId: guard.userId,
    targetType: "Job",
    targetId: input.jobId,
    message:
      scope === "pause"
        ? `Paused a recurring schedule: ${res.cancelled} upcoming booking${res.cancelled === 1 ? "" : "s"} cancelled up to ${until!.toDateString()}.`
        : `Ended a recurring schedule: ${res.cancelled} future booking${res.cancelled === 1 ? "" : "s"} cancelled.`,
  }).catch(() => {});

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/jobs");
  return { ok: true, cancelled: res.cancelled };
}

function normalizeScope(raw: string): SeriesCancelScope {
  return raw === "future" || raw === "pause" ? raw : "this";
}

/** A date the admin picked. Anything unparseable is treated as absent. */
function parseUntil(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
