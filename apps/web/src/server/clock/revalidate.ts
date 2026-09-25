// What a clock action makes stale, in one place (API_V1.md §5, "Invalidation
// is shared"). A clock-in from a phone changes what the office's screens show
// just as much as one from the web, so both front doors call these.
//
// The paths are exactly the ones the web actions revalidated before the logic
// moved into services.
import "server-only";

import { revalidatePath } from "next/cache";

export function revalidateAfterClockIn(jobId: string): void {
  revalidatePath("/cleaners/my-jobs");
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin/time-tracking");
}

export function revalidateAfterBreak(jobId: string): void {
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin/time-tracking");
}

/**
 * The surfaces that render clock state, revalidated on a clock-out FAILURE
 * that means "the database has already moved past what your screen shows".
 */
export function revalidateClockSurfaces(jobId: string): void {
  revalidatePath("/cleaners/my-jobs");
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
  revalidatePath(`/admin/jobs/${jobId}`);
}

export function revalidateAfterClockOut(jobId: string, userId: string): void {
  revalidatePath("/cleaners/my-jobs");
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath(`/admin/employees/${userId}`);
  revalidatePath("/admin/time-tracking");
  revalidatePath("/admin/finances");
  revalidatePath("/admin/analytics");
  revalidatePath("/cleaners/my-inventory");
}

/** The two cleaner screens that show a job's checklist. */
export function revalidateAfterChecklist(jobId: string): void {
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
}
