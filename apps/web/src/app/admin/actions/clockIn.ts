"use server";

import { auth } from "@/lib/auth";
import { isStaffRole } from "@/lib/role-routing";
import { headers } from "next/headers";

import { actorFromSession } from "@/server/actor";
import { clockInService, reportClockInCrash } from "@/server/clock/clock-in";
import { revalidateAfterClockIn } from "@/server/clock/revalidate";
import { fireEffects } from "@/server/effects";

/**
 * Clock in to a job. The rules — assignment, the early window, lateness, the
 * penalty, the strike, the mirrors and the emails — live in
 * server/clock/clock-in.ts, shared with the phone's
 * POST /api/v1/jobs/:id/clock-in. This is the web's front door onto them, and
 * it answers exactly as it always has.
 */
export async function clockIn(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }
  // Being on the job is checked below; being someone who works here is
  // checked first, so no account outside the staff roles gets that far.
  if (!isStaffRole((session.user as { role?: string }).role)) {
    return { success: false, error: "Not authorized" };
  }

  const actor = actorFromSession(
    session.user as { id: string; name?: string | null; email: string; role?: string | null },
  );

  try {
    const result = await clockInService(actor, { jobId, now: new Date() });
    if (!result.ok) return { success: false, error: result.message };

    fireEffects(result.effects);
    revalidateAfterClockIn(jobId);

    const { minutesLate, penalty, resumed, staffing } = result.value;
    return { success: true, minutesLate, penalty, resumed, staffing };
  } catch (error) {
    console.error("Error clocking in:", error);
    await reportClockInCrash(actor, jobId, error);
    return { success: false, error: "Failed to clock in" };
  }
}
