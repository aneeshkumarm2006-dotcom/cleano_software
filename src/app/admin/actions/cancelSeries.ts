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
  | { ok: true; siblings: number; protectedCount: number; resumesOn: string | null }
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
