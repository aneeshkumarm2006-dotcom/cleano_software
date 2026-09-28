"use server";

import { auth } from "@/lib/auth";
import { isStaffRole } from "@/lib/role-routing";
import { headers } from "next/headers";

import { actorFromSession } from "@/server/actor";
import { endBreakService, startBreakService } from "@/server/clock/breaks";
import { revalidateAfterBreak } from "@/server/clock/revalidate";

/**
 * Start / end a break while clocked in to a job (awer_fixes.pdf item 26).
 *
 * The rules live in server/clock/breaks.ts, shared with the phone's break
 * endpoints. These actions are the web's front door onto them and answer
 * exactly as they always have.
 */

async function staffActor() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { error: "Not authenticated" } as const;
  if (!isStaffRole((session.user as { role?: string }).role)) {
    return { error: "Not authorized" } as const;
  }
  return {
    actor: actorFromSession(
      session.user as { id: string; name?: string | null; email: string; role?: string | null },
    ),
  } as const;
}

export async function startJobBreak(jobId: string) {
  const who = await staffActor();
  if ("error" in who) return { success: false, error: who.error };

  const result = await startBreakService(who.actor, { jobId, now: new Date() });
  if (!result.ok) return { success: false, error: result.message };

  revalidateAfterBreak(jobId);
  return { success: true };
}

export async function endJobBreak(jobId: string) {
  const who = await staffActor();
  if ("error" in who) return { success: false, error: who.error };

  const result = await endBreakService(who.actor, { jobId, now: new Date() });
  if (!result.ok) return { success: false, error: result.message };

  revalidateAfterBreak(jobId);
  return { success: true };
}
