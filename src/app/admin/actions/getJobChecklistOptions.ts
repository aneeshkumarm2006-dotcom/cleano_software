"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { listChecklistTemplateOptions } from "@/lib/checklist-options.server";
import type { ChecklistTemplateOption } from "@/lib/checklist-options";

/**
 * Checklist templates for the job modal's "Checklist" picker (Stage 10 / PDF
 * #10, step 10.5).
 *
 * A thin auth wrapper — the query and the labels live in
 * src/lib/checklist-options.server.ts, which the full-page job form imports
 * directly during render. Both job-save paths therefore offer the identical
 * list rather than two lists that can drift.
 *
 * Loaded lazily when the modal opens rather than threaded as a prop: JobModal
 * has five mount points (jobs list, job detail, two calendars, calendar job
 * actions), and a required prop would have to be plumbed through all five, plus
 * their pages' queries, to show one select. The modal already loads
 * `getJobSeriesInfo` and `checkAvailabilityBatch` the same way.
 */
export async function getJobChecklistOptions(): Promise<
  | { success: true; templates: ChecklistTemplateOption[] }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  // ADMIN_ROLES minus CLIENT/EMPLOYEE: anyone who can open the job modal.
  if (role === "CLIENT" || role === "EMPLOYEE" || role === "APPLICANT" || !role) {
    return { success: false, error: "Not authorized" };
  }

  try {
    return { success: true, templates: await listChecklistTemplateOptions() };
  } catch (error) {
    console.error("getJobChecklistOptions failed", error);
    return { success: false, error: "Could not load checklist templates" };
  }
}
