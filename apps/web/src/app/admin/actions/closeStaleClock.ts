"use server";

// Closing a clock somebody forgot to stop.
//
// DELEGATES, for the same reason `decideTimeLogChange` does. `updateClockTimes`
// is not a one-line write: it validates the pair, refuses an edit inside a
// locked pay period, rewrites the job-level and assignment mirrors so the next
// clock action does not revert it, re-snapshots hourly pay and billed hours,
// and writes the job log. A clock closed from this queue has to be identical to
// one an admin typed on the job page, or payroll ends up with two kinds of
// corrected hours that behave differently.
//
// It also sends BOTH times, always. `updateClockTimes` reads null as "clear
// this time", so passing null for the clock-in while setting the clock-out
// would erase the start and zero the shift — the exact trap that had to be
// closed in the time-log approval path.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/org-db";
import { isAdminRole } from "@/lib/role-routing";
import { updateClockTimes } from "./updateClockTimes";
import { isStale } from "@/lib/stale-clock";

type Result = { success: true; warning?: string } | { success: false; error: string };

export async function closeStaleClock(input: {
  sessionId: string;
  /** The end time an admin CONFIRMED. Never defaulted server-side. */
  endedAt: string;
  reason?: string;
}): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  if (!isAdminRole((session.user as { role?: string }).role)) {
    return { success: false, error: "Not authorized" };
  }

  if (typeof input.sessionId !== "string" || !input.sessionId) {
    return { success: false, error: "Invalid request" };
  }

  const end = new Date(input.endedAt);
  if (Number.isNaN(end.getTime())) {
    return { success: false, error: "That finish time isn't a real time." };
  }

  try {
    const row = await db.jobWorkSession.findUnique({
      where: { id: input.sessionId },
      select: { id: true, jobId: true, startedAt: true, endedAt: true },
    });
    if (!row) return { success: false, error: "That time entry no longer exists." };

    // Someone else got there first. Saying so beats overwriting their answer.
    if (row.endedAt) {
      return {
        success: false,
        error: "This clock has already been closed. Refresh to see the current times.",
      };
    }

    // Re-checked here, not trusted from the client: a row that stopped being
    // stale between the page load and the click (the cleaner finally clocked
    // out, an admin edited it) must not be closed from a stale queue.
    if (!isStale({ startedAt: row.startedAt, endedAt: null })) {
      return {
        success: false,
        error: "This clock isn't old enough to close from here. Edit it on the job instead.",
      };
    }

    if (end.getTime() <= row.startedAt.getTime()) {
      return { success: false, error: "The finish has to be after the start." };
    }
    if (end.getTime() > Date.now()) {
      return { success: false, error: "The finish can't be in the future." };
    }

    const applied = await updateClockTimes({
      jobId: row.jobId,
      sessionId: row.id,
      // Sent unchanged. Null here would CLEAR the clock-in.
      clockInTime: row.startedAt.toISOString(),
      clockOutTime: end.toISOString(),
      reason:
        input.reason?.trim() ||
        `Closed a clock left running since ${row.startedAt.toISOString()}.`,
    });
    if (!applied.success) {
      return { success: false, error: `Couldn't close it: ${applied.error}` };
    }

    revalidatePath("/admin/notifications");
    revalidatePath("/admin/time-tracking");
    revalidatePath(`/admin/jobs/${row.jobId}`);
    return { success: true, warning: applied.warning };
  } catch (e) {
    console.error("closeStaleClock", e);
    return { success: false, error: "Couldn't close that clock. Nothing was changed." };
  }
}

/** The queue itself, for the panel. Read-only. */
export async function listStaleClocksForAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return [];
  if (!isAdminRole((session.user as { role?: string }).role)) return [];
  const { listStaleClocks } = await import("@/lib/stale-clock.server");
  try {
    return await listStaleClocks();
  } catch (e) {
    console.error("listStaleClocksForAdmin", e);
    return [];
  }
}
