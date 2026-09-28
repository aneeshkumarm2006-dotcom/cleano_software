// What a manager decision makes stale (API_V1.md §5, "Invalidation is
// shared"): the paths the web's own actions revalidate for the same change,
// so a decision from the phone refreshes the office's screens too.
import "server-only";

import { revalidatePath } from "next/cache";

export function revalidateAfterTimeDecision(jobId: string): void {
  revalidatePath("/admin/notifications");
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin/jobs");
  revalidatePath("/admin/time-tracking");
  revalidatePath("/admin/payouts");
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
}

export function revalidateAfterWithdrawalDecision(): void {
  revalidatePath("/cleaners/my-pay");
  revalidatePath("/admin/payouts");
}

export function revalidateAfterKitDecision(employeeId: string): void {
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/settings");
}

export function revalidateAfterIssueChange(jobId: string): void {
  revalidatePath("/admin/issues");
  revalidatePath(`/admin/jobs/${jobId}`);
}
