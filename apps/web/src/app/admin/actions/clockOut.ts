"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isStaffRole } from "@/lib/role-routing";
import type { ClosingReport } from "@bookmops/core/time";

import { actorFromSession } from "@/server/actor";
import {
  clockOutNotAuthenticated,
  clockOutNotStaff,
  clockOutService,
  type ClockOutResult,
} from "@/server/clock/clock-out";
import { fireEffects } from "@/server/effects";

export type { ClockOutResult, ClockOutSuccess } from "@/server/clock/clock-out";

/**
 * Cleaner clock-out, with the closing inventory report.
 *
 * The rules — the stranded-session rule, the resume path, the report, the
 * flags, the single transaction, finishing the job, the snapshots and the
 * rating request — live in server/clock/clock-out.ts, shared with the phone's
 * POST /api/v1/jobs/:id/clock-out. Their history is written up there. This is
 * the web's front door onto them, and it answers exactly as it always has.
 */
export async function clockOut(
  jobId: string,
  report: ClosingReport
): Promise<ClockOutResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return clockOutNotAuthenticated();
  if (!isStaffRole((session.user as { role?: string }).role)) return clockOutNotStaff();

  const outcome = await clockOutService(
    actorFromSession(session.user as { id: string; name?: string | null; email: string; role?: string | null }),
    { jobId, report, now: new Date(), allowResume: true }
  );
  fireEffects(outcome.effects);
  return outcome.result;
}
