"use server";

import { auth } from "@/lib/auth";
import { isStaffRole } from "@/lib/role-routing";
import { headers } from "next/headers";

import { actorFromSession } from "@/server/actor";
import { claimJobService } from "@/server/available/claim";
import { revalidateAfterClaim } from "@/server/available/revalidate";
import { fireEffects } from "@/server/effects";

/**
 * Claim an open job from the board. The rules — the job still open, a spot
 * left, the cleaner's categories, the trainee rule, a hold, an unsettled
 * quote, the start time — and the write itself live in
 * server/available/claim.ts, shared with the phone's
 * POST /api/v1/jobs/available/:id/claim. This is the web's front door onto
 * them, and it answers with the same messages it always has.
 */
export async function claimJob(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (!isStaffRole(role)) return { success: false, error: "Not authorized" };

  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64) {
    return { success: false, error: "Job not found" };
  }

  const actor = actorFromSession(
    session.user as { id: string; name?: string | null; email: string; role?: string | null },
  );

  try {
    const result = await claimJobService(actor, { jobId, now: new Date() });
    if (!result.ok) return { success: false, error: result.message };

    // The office's "grabbed" notice, not awaited: the claim is committed, and
    // a notice that fails must never tell a cleaner they missed a job they hold.
    fireEffects(result.effects);
    revalidateAfterClaim();
    return { success: true };
  } catch (e) {
    console.error("claimJob", e);
    return { success: false, error: "This job is no longer available" };
  }
}
