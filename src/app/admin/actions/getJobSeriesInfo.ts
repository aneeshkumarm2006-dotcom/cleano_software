"use server";

import { requireOwnerAdmin } from "@/lib/action-guards";
import { getSeriesInfo } from "@/lib/job-series";

/**
 * Does this job belong to a recurring series, and how many occurrences would an
 * "apply to the whole series" edit actually change? (awer_fixes.pdf item 9.)
 *
 * Used by the job modal to decide whether to offer the series checkbox at all,
 * and to state the real count instead of a vague "and future jobs".
 */
export async function getJobSeriesInfo(
  jobId: string
): Promise<
  | { success: true; isSeries: boolean; editableCount: number }
  | { success: false; error: string }
> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  if (typeof jobId !== "string" || !jobId.trim()) {
    return { success: false, error: "Job id is required" };
  }

  try {
    const info = await getSeriesInfo(jobId.trim());
    return {
      success: true,
      isSeries: info.isSeries,
      editableCount: info.editableCount,
    };
  } catch (error) {
    console.error("getJobSeriesInfo failed", error);
    // Non-fatal: the modal just won't offer the series option.
    return { success: false, error: "Could not load recurring series info" };
  }
}
