"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ensureJobChecklist } from "@/lib/job-checklist.server";

/**
 * Generate (or refresh) the job checklist for the current employee.
 *
 * The rules and every DB write now live in `src/lib/job-checklist.server.ts`, so
 * the cleaner's job page can run them during render (item 12.a — a checklist
 * with zero clicks). This action is the authenticated entry point for the
 * clock-out modal, which still generates on demand; all it adds is the session,
 * the admin bypass, and the cache revalidation a server component cannot do.
 *
 * Idempotent, as before. A job with no matching template now produces NO
 * checklist row rather than an empty one — see the store for why that mattered.
 */
export async function generateJobChecklist(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false as const, error: "Not authenticated" };
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true },
  });
  if (!job) return { success: false as const, error: "Job not found" };

  const role = (session.user as { role?: string }).role;
  const isAdmin = role === "OWNER" || role === "ADMIN";

  const result = await ensureJobChecklist(jobId, session.user.id, {
    bypassParticipantCheck: isAdmin,
  });

  if (result.reason === "NOT_AUTHORIZED") {
    return { success: false as const, error: "Not authorized for this job" };
  }
  if (result.reason === "JOB_NOT_FOUND") {
    return { success: false as const, error: "Job not found" };
  }
  if (result.reason === "ERROR") {
    return { success: false as const, error: "Failed to generate checklist" };
  }

  revalidatePath(`/cleaners/my-jobs/${jobId}`);

  // `checklistId` stays in the payload for existing callers; it is null when no
  // template matches this job, which is now a legitimate, non-error outcome.
  return {
    success: true as const,
    checklistId: result.checklist?.id ?? null,
    checklist: result.checklist,
    stale: result.stale,
  };
}
